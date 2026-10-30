"""Load the Cafe graph in your own notebook: cafe export --format networkx, then python networkx-example.py <file>."""
import json, sys
import networkx as nx

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
try:
    G = nx.node_link_graph(data, edges="edges")  # NetworkX 3.4 and later
except TypeError:
    G = nx.node_link_graph(data, link="edges")  # older NetworkX
stored = G.edge_subgraph([(u, v, k) for u, v, k, d in G.edges(keys=True, data=True) if not d.get("derived")])
U = nx.Graph(stored.to_undirected())
top = sorted(nx.betweenness_centrality(U).items(), key=lambda x: -x[1])[:5]
print(G, "| stored facts:", stored.number_of_edges(), "links")
print("Most central:", [(G.nodes[n]["label"], round(s, 3)) for n, s in top])
