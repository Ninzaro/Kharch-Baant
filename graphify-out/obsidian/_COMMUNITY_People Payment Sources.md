---
type: community
cohesion: 0.14
members: 20
---

# People Payment Sources

**Cohesion:** 0.14 - loosely connected
**Members:** 20 nodes

## Members
- [[TAG_EMOJIS]] - code - services/supabaseApiService.ts
- [[addPaymentSource()_1]] - code - services/supabaseApiService.ts
- [[addPerson()_1]] - code - services/supabaseApiService.ts
- [[anonymizeMyAccount()_1]] - code - services/supabaseApiService.ts
- [[archivePaymentSource()_1]] - code - services/supabaseApiService.ts
- [[batchApplyEmojisToGroupTransactions()_1]] - code - services/supabaseApiService.ts
- [[cleanupExpiredInvites()]] - code - services/supabaseApiService.ts
- [[deactivateInvite()]] - code - services/supabaseApiService.ts
- [[deletePaymentSource()_1]] - code - services/supabaseApiService.ts
- [[getPaymentSources()_1]] - code - services/supabaseApiService.ts
- [[getPeople()_1]] - code - services/supabaseApiService.ts
- [[mapDbGroupRowBasic()]] - code - services/supabaseApiService.ts
- [[mergePersonByEmail()]] - code - services/supabaseApiService.ts
- [[subscribeToGroupMembers()_1]] - code - services/supabaseApiService.ts
- [[subscribeToGroups()_1]] - code - services/supabaseApiService.ts
- [[subscribeToPaymentSources()_1]] - code - services/supabaseApiService.ts
- [[subscribeToPeople()_1]] - code - services/supabaseApiService.ts
- [[supabaseApiService.ts]] - code - services/supabaseApiService.ts
- [[transformDbPaymentSourceToAppPaymentSource()]] - code - services/supabaseApiService.ts
- [[transformDbPersonToAppPerson()]] - code - services/supabaseApiService.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/People_Payment_Sources
SORT file.name ASC
```

## Connections to other communities
- 11 edges to [[_COMMUNITY_Expense Forms and Tags]]
- 8 edges to [[_COMMUNITY_Settings Profile Avatars]]
- 7 edges to [[_COMMUNITY_Group Archive Operations]]
- 7 edges to [[_COMMUNITY_App Shell and Queries]]
- 7 edges to [[_COMMUNITY_Transaction CRUD API]]
- 5 edges to [[_COMMUNITY_Supabase Client Types]]
- 5 edges to [[_COMMUNITY_Group Invite Operations]]
- 4 edges to [[_COMMUNITY_API Facade Layer]]
- 4 edges to [[_COMMUNITY_Balances and Settle-Up]]
- 3 edges to [[_COMMUNITY_Clerk Auth Bridge]]
- 2 edges to [[_COMMUNITY_Modals and Icon Set]]
- 1 edge to [[_COMMUNITY_Email Notification Service]]

## Top bridge nodes
- [[supabaseApiService.ts]] - degree 79, connects to 12 communities
- [[transformDbPersonToAppPerson()]] - degree 8, connects to 3 communities
- [[mergePersonByEmail()]] - degree 3, connects to 1 community