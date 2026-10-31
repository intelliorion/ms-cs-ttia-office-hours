"""Whole-network analysis of the Cafe graph with NetworkX.

The app builds the graph (src/graph/build.ts: the form, the AI links, the operator's edits and, when asked, the
links the rules derive). This script only analyses it. It reads one JSON object on stdin:

    {"graph": <node-link JSON>, "analyses": ["stats", ...], "options": {...}}

and writes one JSON object on stdout: {"networkx": "<version>", "python": "<version>", "results": {...}}.
It never writes anything else, never touches the network and never changes the graph: a suggested link is only
ever returned, for the operator to accept or not.

It is run as `python -I -S network.py <path-to-networkx-wheel>`: -I and -S keep out whatever the machine has
installed (another NetworkX, numpy, scipy), so the vendored, pure-Python NetworkX is the one used and every
algorithm below is one that runs without numpy or scipy. Output is deterministic: fixed seeds, sorted lists,
rounded scores.
"""

import itertools
import json
import math
import sys

if len(sys.argv) > 1:
    # The vendored wheel: a zip that zipimport reads as it is, nothing unpacked.
    sys.path.insert(0, sys.argv[1])

try:
    import networkx as nx  # noqa: E402
except Exception as e:  # a missing or broken wheel: one line, never a stack trace
    sys.stdout.write(json.dumps({"error": "NetworkX could not be loaded (%s: %s)" % (type(e).__name__, e)}))
    sys.exit(3)

SEED = 42
# Rounds and the division are left out of the analysis graph: a round links every idea in it and the division every
# team, so they would sit at the centre of everything and join ideas that have nothing else in common.
LEFT_OUT = {"Round", "Entity"}
# The relations a dependency cycle could run along (DEPENDS_ON is derived: only there with derived links).
CYCLE_RELS = {"NEEDS", "USES_DATA", "DEPENDS_ON"}
# Links an operator can make by hand that link prediction proposes: (from type, relation, to type, evidence types).
# Two stars are peers on the evidence of the relation's kind only: two ideas by the capabilities and pain points they
# share, two capabilities by the systems they use. Sharing a person, an outcome or an idea is no evidence that a
# capability uses a system (that is how "Key term extraction uses Team onboarding checklists" came about).
SUGGESTABLE = [("Idea", "NEEDS", "Capability", ("Capability", "PainPoint")), ("Capability", "USES_DATA", "System", ("System",))]
# Form choices: a submitter picks them from a short list, so nearly every idea shares one. They would sit at the centre
# of the network and make every pair of ideas look alike, so central and suggest leave them out unless asked.
FORM_CHOICES = {"Outcome", "Support", "Category", "Beneficiary"}
# A peer must share at least this many evidence stars, and a suggestion needs at least this many such peers: one peer
# alone is a coincidence (it is how a capability that shares two systems with a busy one "should use" all of its others).
MIN_SHARED = 2
MIN_PEERS = 2
# The kinds "central" reports one list for each.
PER_TYPE = ["Capability", "System", "Person", "Team", "Tool", "PainPoint"]
# Above this many stars betweenness is estimated from a fixed sample of starting points (seeded) to stay quick.
BETWEENNESS_EXACT_MAX = 3000
BETWEENNESS_SAMPLE = 600


def r4(x):
    return round(float(x), 4)


def load(payload):
    """The node-link JSON as a MultiDiGraph (every link kept, with its relation), plus the undirected analysis graph."""
    data = payload["graph"]
    full = nx.MultiDiGraph()
    for n in data.get("nodes", []):
        full.add_node(n["id"], type=n.get("type", ""), label=n.get("label", n["id"]))
    for e in data.get("edges", data.get("links", [])):
        s, t = e["source"], e["target"]
        if s in full and t in full:
            full.add_edge(s, t, key=e.get("key", e.get("rel")), rel=e.get("rel", ""), derived=bool(e.get("derived")))
    g = nx.Graph()
    for n, a in full.nodes(data=True):
        if a["type"] not in LEFT_OUT:
            g.add_node(n, **a)
    for s, t, a in full.edges(data=True):
        if s in g and t in g and s != t:
            if g.has_edge(s, t):
                g[s][t]["rels"].append({"from": s, "rel": a["rel"], "to": t})
            else:
                g.add_edge(s, t, rels=[{"from": s, "rel": a["rel"], "to": t}])
    return full, g


def core(g, opts):
    """The analysis graph without the form choices, unless the caller asked for them (formChoices: true)."""
    if opts.get("formChoices"):
        return g
    return g.subgraph([n for n, a in g.nodes(data=True) if a["type"] not in FORM_CHOICES]).copy()


def star(g, n, **extra):
    a = g.nodes[n]
    out = {"id": n, "type": a["type"], "label": a["label"]}
    out.update(extra)
    return out


def by_label(g):
    return lambda n: (g.nodes[n]["label"].lower(), n)


def stats(full, g, opts):
    comps = list(nx.connected_components(g))
    types = {}
    for _, a in full.nodes(data=True):
        types[a["type"]] = types.get(a["type"], 0) + 1
    return {
        "nodes": full.number_of_nodes(),
        "links": full.number_of_edges(),
        "analysed": {"nodes": g.number_of_nodes(), "links": g.number_of_edges()},
        "density": r4(nx.density(g)) if g.number_of_nodes() > 1 else 0.0,
        "components": len(comps),
        "largestComponent": max((len(c) for c in comps), default=0),
        "averageClustering": r4(nx.average_clustering(g)) if g.number_of_nodes() else 0.0,
        "byType": dict(sorted(types.items())),
    }


def central(full, g, opts):
    g = core(g, opts)
    top = int(opts.get("top", 10))
    n = g.number_of_nodes()
    if n == 0:
        return {"betweenness": [], "degree": [], "byType": {}, "sampled": False}
    sampled = n > BETWEENNESS_EXACT_MAX
    if sampled:
        bc = nx.betweenness_centrality(g, k=BETWEENNESS_SAMPLE, seed=SEED, normalized=True)
    else:
        bc = nx.betweenness_centrality(g, normalized=True)
    dc = nx.degree_centrality(g)
    key = by_label(g)

    def ranked(scores, nodes):
        return sorted(nodes, key=lambda x: (-scores[x], key(x)))

    def row(x):
        ideas = sum(1 for y in g[x] if g.nodes[y]["type"] == "Idea")
        return star(g, x, betweenness=r4(bc[x]), degree=r4(dc[x]), links=g.degree(x), ideas=ideas)

    # Ideas are what the programme counts, not what holds it together: the overall lists rank the other stars.
    stars = [x for x in g.nodes if g.nodes[x]["type"] != "Idea"]
    want = opts.get("types") or PER_TYPE
    by_type = {}
    for t in want:
        of = [x for x in stars if g.nodes[x]["type"] == t]
        if of:
            by_type[t] = [row(x) for x in ranked(bc, of)[:top]]
    return {
        "betweenness": [row(x) for x in ranked(bc, stars)[:top]],
        "degree": [row(x) for x in ranked(dc, stars)[:top]],
        "byType": by_type,
        "sampled": sampled,
        "formChoices": "included" if opts.get("formChoices") else "left out",
    }


def idea_projection(g):
    """
    The ideas as a graph of their own: two ideas are joined when they share stars (a capability, a pain point, a
    system, a person, a category ...), each shared star weighted 1 / log(number of ideas it touches), as in
    Adamic-Adar. A star nearly every idea shares (a common outcome) then weighs little, and one only two ideas share
    weighs most.

    Why project instead of running Louvain on the whole graph: on the whole graph the communities mix ideas with
    people, capabilities and form choices, and the question asked is "which ideas belong together". The projection
    answers it directly, and the stars each pair shares are the reason the group exists, which the operator can check.
    """
    ideas = sorted(x for x in g.nodes if g.nodes[x]["type"] == "Idea")
    p = nx.Graph()
    p.add_nodes_from(ideas)
    shared = {}
    for s in sorted(g.nodes):
        if g.nodes[s]["type"] == "Idea":
            continue
        around = sorted(y for y in g[s] if g.nodes[y]["type"] == "Idea")
        if len(around) < 2:
            continue
        w = 1.0 / math.log(len(around))
        for a, b in itertools.combinations(around, 2):
            if p.has_edge(a, b):
                p[a][b]["weight"] += w
            else:
                p.add_edge(a, b, weight=w)
            shared.setdefault((a, b), []).append(s)
    return p, shared


def clusters(full, g, opts):
    p, shared = idea_projection(g)
    method = "Louvain communities over the ideas, joined by the stars they share"
    if p.number_of_edges() == 0:
        alone = sorted(p.nodes, key=by_label(g))
        return {"clusters": [], "alone": [star(g, x) for x in alone], "modularity": 0.0, "method": method}
    comms = nx.community.louvain_communities(p, weight="weight", seed=SEED, resolution=float(opts.get("resolution", 1.0)))
    modularity = nx.community.modularity(p, comms, weight="weight")
    out, alone = [], []
    for c in comms:
        members = sorted(c, key=by_label(g))
        if len(members) == 1:
            alone.append(star(g, members[0]))
            continue
        # The stars that bind the group: shared by two or more of its ideas, the most shared first.
        count = {}
        for a, b in itertools.combinations(sorted(members), 2):
            for s in shared.get((a, b), []):
                count.setdefault(s, set()).update((a, b))
        binding = sorted(count, key=lambda s: (-len(count[s]), by_label(g)(s)))[:6]
        inside = sum(p[a][b]["weight"] for a, b in itertools.combinations(members, 2) if p.has_edge(a, b))
        out.append({
            "ideas": [star(g, x) for x in members],
            "binding": [star(g, s, ideas=len(count[s])) for s in binding],
            "weight": r4(inside),
        })
    out.sort(key=lambda c: (-len(c["ideas"]), -c["weight"], c["ideas"][0]["label"].lower()))
    alone.sort(key=lambda s: (s["label"].lower(), s["id"]))
    return {"clusters": out, "alone": alone, "modularity": r4(modularity), "method": method}


def path(full, g, opts):
    a, b = opts.get("a"), opts.get("b")
    if a not in full or b not in full:
        return {"found": False, "reason": "not in the graph", "paths": []}
    if a not in g or b not in g:
        return {"found": False, "reason": "rounds and the division are left out of the analysis", "paths": []}
    if a == b:
        return {"found": False, "reason": "the same star twice", "paths": []}
    if not nx.has_path(g, a, b):
        return {"found": False, "reason": "no chain of links joins them", "paths": []}
    limit = int(opts.get("limit", 3))
    paths = list(itertools.islice(nx.all_shortest_paths(g, a, b), 200))
    paths.sort(key=lambda p: [(g.nodes[x]["label"].lower(), x) for x in p])
    out = []
    for p in paths[:limit]:
        hops = []
        for x, y in zip(p, p[1:]):
            rels = sorted(g[x][y]["rels"], key=lambda r: (r["rel"], r["from"]))
            hops.append({"from": x, "to": y, "rels": rels})
        out.append({"stars": [star(g, x) for x in p], "hops": hops})
    return {"found": True, "length": len(paths[0]) - 1, "count": len(paths), "paths": out}


def isolated(full, g, opts):
    comps = sorted(nx.connected_components(g), key=lambda c: (-len(c), min(by_label(g)(x) for x in c)))
    if not comps:
        return {"components": 0, "main": 0, "apart": [], "outside": [], "groupsApart": 0}
    apart = []
    for c in comps[1:]:
        members = sorted(c, key=by_label(g))
        kinds = {}
        for x in members:
            kinds.setdefault(g.nodes[x]["type"], []).append(x)
        apart.append({
            "size": len(members),
            "ideas": [star(g, x) for x in kinds.get("Idea", [])],
            "teams": [star(g, x) for x in kinds.get("Team", [])],
            "systems": [star(g, x) for x in kinds.get("System", [])],
            "stars": [star(g, x) for x in members[:12]],
        })
    # Ideas, teams and systems outside the main group, in one list, ideas first.
    order = {"Idea": 0, "Team": 1, "System": 2}
    flat = sorted(
        (s for c in apart for s in c["ideas"] + c["teams"] + c["systems"]),
        key=lambda s: (order[s["type"]], s["label"].lower(), s["id"]),
    )
    return {"components": len(comps), "main": len(comps[0]), "apart": apart[:30], "outside": flat[:60], "groupsApart": len(apart)}


def suggest(full, g, opts):
    """
    Links that are probably missing. Link prediction on the evidence graph of each relation: two stars of the same kind
    are peers on what they share of the relation's evidence (two ideas: capabilities and pain points; two capabilities:
    systems), scored with NetworkX's Adamic-Adar index and Jaccard coefficient on that bipartite graph, and a pair is a
    peer only when it shares MIN_SHARED evidence stars or more. Each star's closest peers (its top three by Adamic-Adar)
    are then read: a target most of them have (by weight) and it lacks is suggested, when MIN_PEERS or more of them have
    it. The pairs are always type-compatible (an idea and a capability, a capability and a system), and the form choices
    are left out (formChoices: true keeps them). The peers and what each shares are the reason given.
    """
    g = core(g, opts)
    top = int(opts.get("top", 10))
    k = int(opts.get("peers", 3))
    min_shared = int(opts.get("minShared", MIN_SHARED))
    min_peers = int(opts.get("minPeers", MIN_PEERS))
    key = by_label(g)
    out = []
    considered = 0
    for ftype, rel, ttype, evidence in SUGGESTABLE:
        sources = sorted((x for x in g.nodes if g.nodes[x]["type"] == ftype), key=key)
        linked = {x: {y for y in g[x] if g.nodes[y]["type"] == ttype and any(r["rel"] == rel and r["from"] == x for r in g[x][y]["rels"])} for x in sources}
        ev = {x: {y for y in g[x] if g.nodes[y]["type"] in evidence} for x in sources}
        # The evidence graph: the sources and their evidence stars, nothing else.
        h = nx.Graph()
        h.add_nodes_from(sources)
        for x in sources:
            for y in ev[x]:
                h.add_edge(x, y)
        pairs = [(a, b) for a, b in itertools.combinations(sources, 2) if len(ev[a] & ev[b]) >= min_shared]
        if not pairs:
            continue
        jac = {}
        for a, b, s in nx.jaccard_coefficient(h, pairs):
            jac[(a, b)] = jac[(b, a)] = s
        peers = {}
        for a, b, s in nx.adamic_adar_index(h, pairs):
            peers.setdefault(a, []).append((b, s))
            peers.setdefault(b, []).append((a, s))
        for x in sources:
            near = sorted(peers.get(x, []), key=lambda p: (-p[1], key(p[0])))[:k]
            mass = sum(s for _, s in near)
            if not mass:
                continue
            score = {}
            for peer, s in near:
                for t in linked[peer] - linked[x]:
                    if not g.has_edge(x, t):
                        score.setdefault(t, []).append((peer, s))
            for t, by in score.items():
                considered += 1
                support = sum(s for _, s in by)
                share = support / mass
                if share < 0.5 or len(by) < min_peers:
                    continue
                out.append({
                    "from": star(g, x), "rel": rel, "to": star(g, t),
                    "adamicAdar": r4(support), "jaccard": r4(max(jac[(x, p)] for p, _ in by)), "share": r4(share), "peerCount": len(by),
                    "because": [
                        {"peer": star(g, p), "adamicAdar": r4(s), "shared": [star(g, n) for n in sorted(ev[x] & ev[p], key=key)[:5]]}
                        for p, s in by
                    ],
                })
    out.sort(key=lambda s: (-s["share"], -s["adamicAdar"], s["from"]["label"].lower(), s["to"]["label"].lower()))
    return {"suggestions": out[:top], "considered": considered, "found": len(out), "peers": k, "minShared": min_shared, "minPeers": min_peers,
            "formChoices": "included" if opts.get("formChoices") else "left out"}


def cycles(full, g, opts):
    d = nx.DiGraph()
    for s, t, a in full.edges(data=True):
        if a["rel"] in CYCLE_RELS:
            d.add_edge(s, t)
    found = []
    for c in itertools.islice(nx.simple_cycles(d), 200):
        i = c.index(min(c))
        found.append(c[i:] + c[:i])
    found.sort(key=lambda c: (len(c), c))
    return {
        "cycles": [[star(full, x) for x in c] for c in found[:20]],
        "count": len(found),
        "relations": sorted(CYCLE_RELS),
        "links": d.number_of_edges(),
    }


ANALYSES = {"stats": stats, "central": central, "clusters": clusters, "path": path, "isolated": isolated, "suggest": suggest, "cycles": cycles}


def main():
    payload = json.load(sys.stdin)
    full, g = load(payload)
    opts = payload.get("options", {})
    results = {}
    for name in payload.get("analyses", []):
        if name not in ANALYSES:
            raise ValueError("unknown analysis " + str(name))
        results[name] = ANALYSES[name](full, g, opts)
    v = sys.version_info
    json.dump({"networkx": nx.__version__, "python": "%d.%d.%d" % (v[0], v[1], v[2]), "results": results}, sys.stdout, sort_keys=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # one line the app can show, never a stack trace
        sys.stdout.write(json.dumps({"error": "%s: %s" % (type(e).__name__, e)}))
        sys.exit(2)
