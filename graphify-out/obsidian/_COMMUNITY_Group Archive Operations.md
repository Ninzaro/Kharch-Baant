---
type: community
cohesion: 0.28
members: 9
---

# Group Archive Operations

**Cohesion:** 0.28 - loosely connected
**Members:** 9 nodes

## Members
- [[ArchivedGroupsModal()]] - code - components/ArchivedGroupsModal.tsx
- [[ArchivedGroupsModal.tsx]] - code - components/ArchivedGroupsModal.tsx
- [[ArchivedGroupsModalProps]] - code - components/ArchivedGroupsModal.tsx
- [[addGroup()_1]] - code - services/supabaseApiService.ts
- [[getArchivedGroups()]] - code - services/supabaseApiService.ts
- [[getGroups()_1]] - code - services/supabaseApiService.ts
- [[transformDbGroupToAppGroup()]] - code - services/supabaseApiService.ts
- [[unarchiveGroup()]] - code - services/supabaseApiService.ts
- [[updateGroup()_1]] - code - services/supabaseApiService.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Group_Archive_Operations
SORT file.name ASC
```

## Connections to other communities
- 7 edges to [[_COMMUNITY_People Payment Sources]]
- 2 edges to [[_COMMUNITY_Modals and Icon Set]]
- 2 edges to [[_COMMUNITY_Settings Profile Avatars]]

## Top bridge nodes
- [[ArchivedGroupsModal.tsx]] - degree 8, connects to 3 communities
- [[transformDbGroupToAppGroup()]] - degree 5, connects to 1 community
- [[ArchivedGroupsModal()]] - degree 4, connects to 1 community
- [[getArchivedGroups()]] - degree 4, connects to 1 community
- [[unarchiveGroup()]] - degree 3, connects to 1 community