---
type: community
cohesion: 0.19
members: 15
---

# Email Notification Service

**Cohesion:** 0.19 - loosely connected
**Members:** 15 nodes

## Members
- [[EmailResult]] - code - services/emailService.ts
- [[EmailType]] - code - services/emailService.ts
- [[GroupInviteEmailData]] - code - services/emailService.ts
- [[MemberAddedEmailData]] - code - services/emailService.ts
- [[NewExpenseEmailData]] - code - services/emailService.ts
- [[SettleUpEmailData]] - code - services/emailService.ts
- [[WelcomeEmailData]] - code - services/emailService.ts
- [[emailService.ts]] - code - services/emailService.ts
- [[invokeSendEmail()]] - code - services/emailService.ts
- [[isEmailServiceEnabled()]] - code - services/emailService.ts
- [[sendGroupInviteEmail()]] - code - services/emailService.ts
- [[sendMemberAddedEmail()]] - code - services/emailService.ts
- [[sendNewExpenseEmail()]] - code - services/emailService.ts
- [[sendSettleUpEmail()]] - code - services/emailService.ts
- [[sendWelcomeEmail()]] - code - services/emailService.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Email_Notification_Service
SORT file.name ASC
```

## Connections to other communities
- 1 edge to [[_COMMUNITY_Supabase Client Types]]
- 1 edge to [[_COMMUNITY_Expense Forms and Tags]]
- 1 edge to [[_COMMUNITY_People Payment Sources]]

## Top bridge nodes
- [[emailService.ts]] - degree 17, connects to 3 communities