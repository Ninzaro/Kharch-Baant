---
type: community
cohesion: 0.33
members: 7
---

# Transaction CRUD API

**Cohesion:** 0.33 - loosely connected
**Members:** 7 nodes

## Members
- [[_broadcastTxChange()]] - code - services/supabaseApiService.ts
- [[addTransaction()_1]] - code - services/supabaseApiService.ts
- [[deleteTransaction()_1]] - code - services/supabaseApiService.ts
- [[getTransactions()_1]] - code - services/supabaseApiService.ts
- [[subscribeToTransactions()_1]] - code - services/supabaseApiService.ts
- [[transformDbTransactionToAppTransaction()]] - code - services/supabaseApiService.ts
- [[updateTransaction()_1]] - code - services/supabaseApiService.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Transaction_CRUD_API
SORT file.name ASC
```

## Connections to other communities
- 7 edges to [[_COMMUNITY_People Payment Sources]]

## Top bridge nodes
- [[transformDbTransactionToAppTransaction()]] - degree 5, connects to 1 community
- [[_broadcastTxChange()]] - degree 4, connects to 1 community
- [[addTransaction()_1]] - degree 3, connects to 1 community
- [[updateTransaction()_1]] - degree 3, connects to 1 community
- [[deleteTransaction()_1]] - degree 2, connects to 1 community