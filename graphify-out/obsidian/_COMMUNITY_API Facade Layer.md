---
type: community
cohesion: 0.14
members: 29
---

# API Facade Layer

**Cohesion:** 0.14 - loosely connected
**Members:** 29 nodes

## Members
- [[dot-onAdded()]] - code - components/MemberInviteModal.tsx
- [[dot-onClose()]] - code - components/MemberInviteModal.tsx
- [[MemberInviteModal()]] - code - components/MemberInviteModal.tsx
- [[MemberInviteModal.tsx]] - code - components/MemberInviteModal.tsx
- [[MemberInviteModalProps]] - code - components/MemberInviteModal.tsx
- [[addGroup()]] - code - services/apiService.ts
- [[addPaymentSource()]] - code - services/apiService.ts
- [[addPerson()]] - code - services/apiService.ts
- [[addPersonToGroup()]] - code - services/apiService.ts
- [[anonymizeMyAccount()]] - code - services/apiService.ts
- [[apiService.ts]] - code - services/apiService.ts
- [[archivePaymentSource()]] - code - services/apiService.ts
- [[batchApplyEmojisToGroupTransactions()]] - code - services/apiService.ts
- [[checkConnection()]] - code - services/apiService.ts
- [[deletePaymentSource()]] - code - services/apiService.ts
- [[deleteTransaction()]] - code - services/apiService.ts
- [[ensureUserExists()]] - code - services/apiService.ts
- [[findPersonByEmail()]] - code - services/supabaseApiService.ts
- [[getGroups()]] - code - services/apiService.ts
- [[getPaymentSources()]] - code - services/apiService.ts
- [[getPeople()]] - code - services/apiService.ts
- [[getTransactions()]] - code - services/apiService.ts
- [[subscribeToGroupMembers()]] - code - services/apiService.ts
- [[subscribeToGroups()]] - code - services/apiService.ts
- [[subscribeToPaymentSources()]] - code - services/apiService.ts
- [[subscribeToPeople()]] - code - services/apiService.ts
- [[subscribeToTransactions()]] - code - services/apiService.ts
- [[updateGroup()]] - code - services/apiService.ts
- [[updateTransaction()]] - code - services/apiService.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/API_Facade_Layer
SORT file.name ASC
```

## Connections to other communities
- 8 edges to [[_COMMUNITY_Balances and Settle-Up]]
- 5 edges to [[_COMMUNITY_Modals and Icon Set]]
- 4 edges to [[_COMMUNITY_People Payment Sources]]
- 3 edges to [[_COMMUNITY_Expense Forms and Tags]]
- 3 edges to [[_COMMUNITY_Settings Profile Avatars]]
- 3 edges to [[_COMMUNITY_App Shell and Queries]]
- 1 edge to [[_COMMUNITY_Supabase Client Types]]

## Top bridge nodes
- [[apiService.ts]] - degree 41, connects to 7 communities
- [[MemberInviteModal.tsx]] - degree 11, connects to 3 communities
- [[MemberInviteModal()]] - degree 7, connects to 1 community
- [[findPersonByEmail()]] - degree 5, connects to 1 community
- [[MemberInviteModalProps]] - degree 4, connects to 1 community