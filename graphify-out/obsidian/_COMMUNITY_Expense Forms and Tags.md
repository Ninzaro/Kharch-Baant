---
type: community
cohesion: 0.06
members: 52
---

# Expense Forms and Tags

**Cohesion:** 0.06 - loosely connected
**Members:** 52 nodes

## Members
- [[AcceptInviteRequest]] - code - types.ts
- [[AcceptInviteResponse]] - code - types.ts
- [[CheckIcon()]] - code - components/icons/Icons.tsx
- [[CreateInviteRequest]] - code - types.ts
- [[CreateInviteResponse]] - code - types.ts
- [[CreditCardDetails]] - code - types.ts
- [[CurrencyDetails]] - code - types.ts
- [[DeleteIcon()]] - code - components/icons/Icons.tsx
- [[EmailInvite]] - code - types.ts
- [[GroupInvite]] - code - types.ts
- [[KEYWORD_MAP]] - code - services/tagKeywords.ts
- [[Payer]] - code - types.ts
- [[PaymentSourceFormModal]] - code - App.tsx
- [[PaymentSourceFormModal()]] - code - components/PaymentSourceFormModal.tsx
- [[PaymentSourceFormModal.tsx]] - code - components/PaymentSourceFormModal.tsx
- [[PaymentSourceFormModalProps]] - code - components/PaymentSourceFormModal.tsx
- [[PaymentSourceMetrics]] - code - utils/paymentSourceMetrics.ts
- [[PaymentSourceType]] - code - types.ts
- [[PersonSource]] - code - types.ts
- [[Split]] - code - types.ts
- [[SplitMode]] - code - types.ts
- [[SplitParticipant]] - code - types.ts
- [[StepId]] - code - components/TransactionFormModal.tsx
- [[TAGS]] - code - types.ts
- [[Tag]] - code - types.ts
- [[TimelineNode()]] - code - components/TransactionFormModal.tsx
- [[TimelineNodeProps]] - code - components/TransactionFormModal.tsx
- [[TransactionFormModal]] - code - App.tsx
- [[TransactionFormModal()]] - code - components/TransactionFormModal.tsx
- [[TransactionFormModal.tsx]] - code - components/TransactionFormModal.tsx
- [[TransactionType]] - code - types.ts
- [[UPIDetails]] - code - types.ts
- [[ValidateInviteResponse]] - code - types.ts
- [[allCurrencies]] - code - types.ts
- [[classifyDescription()]] - code - services/tagClassifier.ts
- [[computePaymentSourceMetrics()]] - code - utils/paymentSourceMetrics.ts
- [[geminiService.ts]] - code - services/geminiService.ts
- [[getIconForCategory()]] - code - services/geminiService.ts
- [[inrIndex]] - code - types.ts
- [[isAiTaggingConfigured()]] - code - services/geminiService.ts
- [[lookupCache()]] - code - services/tagClassifier.ts
- [[matchKeyword()]] - code - services/tagKeywords.ts
- [[normalize()]] - code - services/tagClassifier.ts
- [[paymentSourceMetrics.ts]] - code - utils/paymentSourceMetrics.ts
- [[sessionCache]] - code - services/tagClassifier.ts
- [[splitModes]] - code - components/TransactionFormModal.tsx
- [[suggestTagForDescription()]] - code - services/geminiService.ts
- [[supabase]] - code - lib/supabase.ts
- [[tagClassifier.ts]] - code - services/tagClassifier.ts
- [[tagKeywords.ts]] - code - services/tagKeywords.ts
- [[types.ts]] - code - types.ts
- [[writeCache()]] - code - services/tagClassifier.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Expense_Forms_and_Tags
SORT file.name ASC
```

## Connections to other communities
- 29 edges to [[_COMMUNITY_Balances and Settle-Up]]
- 20 edges to [[_COMMUNITY_Modals and Icon Set]]
- 12 edges to [[_COMMUNITY_App Shell and Queries]]
- 11 edges to [[_COMMUNITY_People Payment Sources]]
- 6 edges to [[_COMMUNITY_Settings Profile Avatars]]
- 3 edges to [[_COMMUNITY_API Facade Layer]]
- 3 edges to [[_COMMUNITY_Supabase Client Types]]
- 2 edges to [[_COMMUNITY_Clerk Auth Bridge]]
- 1 edge to [[_COMMUNITY_Email Notification Service]]

## Top bridge nodes
- [[types.ts]] - degree 68, connects to 7 communities
- [[supabase]] - degree 10, connects to 6 communities
- [[TransactionFormModal.tsx]] - degree 32, connects to 4 communities
- [[PaymentSourceFormModal.tsx]] - degree 9, connects to 2 communities
- [[TAGS]] - degree 5, connects to 2 communities