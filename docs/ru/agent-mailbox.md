# Agent Mailbox

`AgentMailbox` — локальный сервис асинхронной доставки Keystone.

```ts
const task = await mailbox.createTask({
  recipient: { identityId: bobIdentity, agentId: 'bob-agent' },
  taskType: 'availability',
  prompt: 'Сможешь завтра?',
  explicitContext: [{
    id: 'window', label: 'Явно расшаренное окно',
    value: 'завтра 10:00', dataClass: 'USER_EXPLICIT',
  }],
});
await mailbox.flush(bobIdentity);
```

Если Bob offline, request остаётся в outbox. После появления Bob вызывает
`acceptTask(taskId)` (или разрешённый policy auto-accept), а response будет
доставлен Alice после её reconnect. `snapshot()` показывает inbox, sent,
responses, receipts, rooms и queued outbox.

Policy локальна и fail-closed: `deny`, `contacts-only`, `trusted-only`, `ask`,
`auto`. `ask` требует отдельного approval boundary. В core проверяются
blocked identities, mailbox/pending/rate quotas, expiry, replay IDs и пределы
delegation chain.

`AgentTaskCapability` подписывается issuer и содержит scope, тип задачи,
subject, expiry и `maxUses`. Получатель проверяет issuer, subject, scope,
expiry, revocation и число использований до вызова bounded executor.
Private/secret result не может стать mailbox response.

Для production передайте зашифрованный `AgentMailboxStateStore`. Core не
получает recovery phrase или private identity key как данные приложения.
