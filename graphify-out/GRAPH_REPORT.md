# Graph Report - Kharch-Baant  (2026-09-12)

## Corpus Check
- 82 files · ~49,857 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 485 nodes · 1157 edges · 23 communities (18 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Balances and Settle-Up
- Modals and Icon Set
- App Shell and Queries
- Expense Forms and Tags
- Settings Profile Avatars
- Native Google Sign-In
- Bootstrap and Deep Links
- API Facade Layer
- People Payment Sources
- Email Notification Service
- Generated Database Types
- Group Archive Operations
- Supabase Client Types
- Native Google Token
- Modal Context State
- Clerk Auth Bridge
- Transaction CRUD API
- Group Invite Operations
- Simple Auth Screen
- Currency Selector
- Language Selector
- Current User Constant

## God Nodes (most connected - your core abstractions)
1. `Person` - 49 edges
2. `Transaction` - 40 edges
3. `Group` - 32 edges
4. `App()` - 23 edges
5. `PaymentSource` - 19 edges
6. `Avatar()` - 16 edges
7. `BaseModal()` - 16 edges
8. `Currency` - 12 edges
9. `calculateGroupBalances()` - 11 edges
10. `useAuth()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `AddActionModalProps` --references--> `Group`  [EXTRACTED]
  components/AddActionModal.tsx → types.ts
- `GroupSelectionListProps` --references--> `Group`  [EXTRACTED]
  components/GroupSelectionList.tsx → types.ts
- `PaymentSourceFormModalProps` --references--> `PaymentSource`  [EXTRACTED]
  components/PaymentSourceFormModal.tsx → types.ts
- `PaymentSourceManageModalProps` --references--> `PaymentSource`  [EXTRACTED]
  components/PaymentSourceManageModal.tsx → types.ts
- `SettingsModalProps` --references--> `Person`  [EXTRACTED]
  components/SettingsModal.tsx → types.ts

## Import Cycles
- None detected.

## Communities (23 total, 4 thin omitted)

### Community 0 - "Balances and Settle-Up"
Cohesion: 0.08
Nodes (46): DeletionRequest, BalanceBreakdownModal(), BalanceBreakdownModalProps, Dashboard(), DashboardProps, GroupBalancesModal(), GroupBalancesModalProps, consoleLogSpy (+38 more)

### Community 1 - "Modals and Icon Set"
Cohesion: 0.06
Nodes (42): AddActionModal, GroupFormModal, SettleUpModal, AddActionModalProps, BaseModal(), BaseModalProps, SIZE_CLASS, CalendarModal() (+34 more)

### Community 2 - "App Shell and Queries"
Cohesion: 0.08
Nodes (39): App(), ArchivePromptModal, PaymentSourceManageModal, preloadGroupForm(), preloadSettings(), preloadSettleUp(), preloadTransactionForm(), TransactionDetailModal (+31 more)

### Community 3 - "Expense Forms and Tags"
Cohesion: 0.06
Nodes (42): PaymentSourceFormModal, TransactionFormModal, CheckIcon(), DeleteIcon(), PaymentSourceFormModalProps, splitModes, StepId, TimelineNodeProps (+34 more)

### Community 4 - "Settings Profile Avatars"
Cohesion: 0.06
Nodes (35): ConfirmDeleteModal, SettingsModal, AboutSection(), AdminDeletionRequestsPanel(), AdminDeletionRequestsPanelProps, UserProfile(), UserProfileProps, Avatar() (+27 more)

### Community 5 - "Native Google Sign-In"
Cohesion: 0.10
Nodes (24): AuthScreen(), AuthScreenProps, NATIVE_HIDE_SOCIAL_CLERK_APPEARANCE, NATIVE_PORTAL_RETURN_URL, NATIVE_SSO_REDIRECT, useNativeGoogleSignIn(), buildAccountPortalOAuthUrl(), CLERK_ACCOUNT_PORTAL_SIGN_IN (+16 more)

### Community 6 - "Bootstrap and Deep Links"
Cohesion: 0.11
Nodes (22): AppWithAuth(), SsoFinish(), ErrorBoundary, ErrorBoundaryProps, ErrorBoundaryState, ToastProvider(), initCapacitor(), root (+14 more)

### Community 7 - "API Facade Layer"
Cohesion: 0.14
Nodes (25): MemberInviteModal(), MemberInviteModalProps, addGroup(), addPaymentSource(), addPerson(), addPersonToGroup(), anonymizeMyAccount(), archivePaymentSource() (+17 more)

### Community 8 - "People Payment Sources"
Cohesion: 0.14
Nodes (12): addPaymentSource(), addPerson(), getPaymentSources(), getPeople(), mapDbGroupRowBasic(), mergePersonByEmail(), subscribeToGroups(), subscribeToPaymentSources() (+4 more)

### Community 9 - "Email Notification Service"
Cohesion: 0.19
Nodes (14): EmailResult, EmailType, GroupInviteEmailData, invokeSendEmail(), isEmailServiceEnabled(), MemberAddedEmailData, NewExpenseEmailData, sendGroupInviteEmail() (+6 more)

### Community 10 - "Generated Database Types"
Cohesion: 0.18
Nodes (10): CompositeTypes, Constants, Database, DatabaseWithoutInternals, DefaultSchema, Enums, Json, Tables (+2 more)

### Community 11 - "Group Archive Operations"
Cohesion: 0.28
Nodes (8): ArchivedGroupsModal(), ArchivedGroupsModalProps, addGroup(), getArchivedGroups(), getGroups(), transformDbGroupToAppGroup(), unarchiveGroup(), updateGroup()

### Community 12 - "Supabase Client Types"
Cohesion: 0.22
Nodes (8): DbGroup, DbGroupMember, DbPaymentSource, DbPerson, DbTransaction, Inserts, Tables, Updates

### Community 13 - "Native Google Token"
Cohesion: 0.25
Nodes (6): GOOGLE_WEB_CLIENT_ID, initNativeGoogleAuth(), NativeGoogleUser, performNativeGoogleSignIn(), IMPORTANT:, IMPORTANT:

### Community 14 - "Modal Context State"
Cohesion: 0.29
Nodes (6): ModalContext, ModalContextValue, ModalProvider(), ModalProviderProps, UseModalsParams, useModals()

### Community 15 - "Clerk Auth Bridge"
Cohesion: 0.48
Nodes (6): AuthContext, AuthContextType, SupabaseAuthProvider(), getClerkSupabaseToken(), setRealtimeAuth(), ensureUserExists()

### Community 16 - "Transaction CRUD API"
Cohesion: 0.33
Nodes (7): addTransaction(), _broadcastTxChange(), deleteTransaction(), getTransactions(), subscribeToTransactions(), transformDbTransactionToAppTransaction(), updateTransaction()

### Community 17 - "Group Invite Operations"
Cohesion: 0.33
Nodes (6): GroupFormModal(), createGroupInvite(), generateInviteToken(), getGroupInvites(), transformDbEmailInviteToAppEmailInvite(), transformDbInviteToAppInvite()

## Knowledge Gaps
- **86 isolated node(s):** `AdminDeletionRequestsPanelProps`, `ArchivePromptModalProps`, `ArchivedGroupsModalProps`, `AvatarProps`, `colors` (+81 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 126 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Person` connect `Balances and Settle-Up` to `Modals and Icon Set`, `App Shell and Queries`, `Expense Forms and Tags`, `Settings Profile Avatars`, `API Facade Layer`, `People Payment Sources`, `Clerk Auth Bridge`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Why does `Transaction` connect `Balances and Settle-Up` to `Modals and Icon Set`, `App Shell and Queries`, `Expense Forms and Tags`, `API Facade Layer`, `People Payment Sources`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `Group` connect `Balances and Settle-Up` to `Modals and Icon Set`, `App Shell and Queries`, `Expense Forms and Tags`, `Settings Profile Avatars`, `API Facade Layer`, `People Payment Sources`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **What connects `AdminDeletionRequestsPanelProps`, `ArchivePromptModalProps`, `ArchivedGroupsModalProps` to the rest of the system?**
  _86 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Balances and Settle-Up` be split into smaller, more focused modules?**
  _Cohesion score 0.08173076923076923 - nodes in this community are weakly interconnected._
- **Should `Modals and Icon Set` be split into smaller, more focused modules?**
  _Cohesion score 0.06265664160401002 - nodes in this community are weakly interconnected._
- **Should `App Shell and Queries` be split into smaller, more focused modules?**
  _Cohesion score 0.07692307692307693 - nodes in this community are weakly interconnected._