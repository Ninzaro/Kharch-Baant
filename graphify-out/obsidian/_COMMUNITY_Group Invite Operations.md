---
type: community
cohesion: 0.33
members: 6
---

# Group Invite Operations

**Cohesion:** 0.33 - loosely connected
**Members:** 6 nodes

## Members
- [[GroupFormModal()]] - code - components/GroupFormModal.tsx
- [[createGroupInvite()]] - code - services/supabaseApiService.ts
- [[generateInviteToken()]] - code - services/supabaseApiService.ts
- [[getGroupInvites()]] - code - services/supabaseApiService.ts
- [[transformDbEmailInviteToAppEmailInvite()]] - code - services/supabaseApiService.ts
- [[transformDbInviteToAppInvite()]] - code - services/supabaseApiService.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Group_Invite_Operations
SORT file.name ASC
```

## Connections to other communities
- 5 edges to [[_COMMUNITY_People Payment Sources]]
- 2 edges to [[_COMMUNITY_Modals and Icon Set]]
- 1 edge to [[_COMMUNITY_App Shell and Queries]]

## Top bridge nodes
- [[createGroupInvite()]] - degree 6, connects to 2 communities
- [[transformDbInviteToAppInvite()]] - degree 4, connects to 2 communities
- [[GroupFormModal()]] - degree 2, connects to 1 community
- [[generateInviteToken()]] - degree 2, connects to 1 community
- [[getGroupInvites()]] - degree 2, connects to 1 community