export const pack = [
  {
    id: "db-aurora-idle-tx-pool",
    title: "AURORA CONNECTION POOL EXHAUSTED",
    sev: "SEV1",
    tags: ["aws", "database", "observability", "oncall"],
    weigh: 3,
    open: [
      ["said", "PagerDuty: [SEV1] checkout-api 503s at 31%, database connections at 100%."],
      ["out", "Aurora PostgreSQL writer: 412 total connections; pool limit 400."],
      ["out", "Checkout p99 is 8.7s; the first alert fired 9 minutes ago."]
    ],
    hint: "Inspect pg_stat_activity before changing limits. Idle-in-transaction sessions can hold locks and consume pool slots.",
    steps: [
      {
        prompt: "What do you inspect before changing capacity?",
        choices: [
          {
            label: "SELECT state, count(*) FROM pg_stat_activity GROUP BY state",
            pts: 9,
            min: 2,
            customers: 0,
            fixesCause: true,
            say: [
              ["cmd", "$ SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"],
              ["out", "active | 100; idle | 194; idle in transaction | 118  (total 412 / limit 400)"],
              ["good", "118 sessions have held transactions open for 41 minutes."],
              ["note", "Classify the pool before tuning it; idle-in-transaction is a leak signal."]
            ]
          },
          {
            label: "Raise Aurora max_connections from 400 to 800",
            pts: -8,
            min: 6,
            customers: 18000,
            fixesCause: false,
            say: [
              ["cmd", "$ aws rds modify-db-parameter-group --db-parameter-group-name aurora-pg15-prod --parameters \"ParameterName=max_connections,ParameterValue=800,ApplyMethod=pending-reboot\""],
              ["warn", "Parameter accepted; restart required for the new limit."],
              ["bad", "The leaking sessions continue; memory pressure pushes the writer into swap."],
              ["note", "A larger bucket does not stop a leak and can make database failure harder."]
            ]
          },
          {
            label: "Restart the Aurora writer to clear every session",
            pts: -5,
            min: 12,
            customers: 42000,
            fixesCause: false,
            say: [
              ["cmd", "$ aws rds reboot-db-instance --db-instance-identifier prod-writer"],
              ["bad", "Failover takes 74 seconds; 42,000 checkout requests return 5xx."],
              ["warn", "The pool is empty only until the application leaks sessions again."],
              ["note", "Restarting the primary erases evidence and treats a client leak as a server fault."]
            ]
          }
        ]
      },
      {
        prompt: "How do you remove only the confirmed leaking sessions?",
        choices: [
          {
            label: "Terminate idle-in-transaction sessions older than 10 minutes",
            pts: 10,
            min: 4,
            customers: 0,
            fixesCause: true,
            say: [
              ["cmd", "$ SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle in transaction' AND now() - xact_start > interval '10 minutes';"],
              ["out", "pg_terminate_backend: 118 rows"],
              ["good", "Pool usage falls 412 -> 281; checkout 5xx falls 31% -> 0.4%."],
              ["note", "Bounded termination releases leaked slots without killing healthy traffic."]
            ]
          },
          {
            label: "SELECT pg_terminate_backend(pid) FROM pg_stat_activity",
            pts: -9,
            min: 4,
            customers: 26000,
            fixesCause: false,
            say: [
              ["cmd", "$ SELECT pg_terminate_backend(pid) FROM pg_stat_activity;"],
              ["bad", "All 412 sessions terminate, including the 100 that were actively serving checkout."],
              ["warn", "Traffic recovers after 38 seconds, but 26,000 requests fail."],
              ["note", "Kill by evidence and age; indiscriminate cleanup expands the blast radius."]
            ]
          },
          {
            label: "Deploy a larger application pool to each checkout pod",
            pts: 2,
            min: 8,
            customers: 9000,
            fixesCause: false,
            say: [
              ["cmd", "$ kubectl -n prod set env deploy/checkout-api DB_POOL_SIZE=80"],
              ["out", "deployment.apps/checkout-api configured"],
              ["warn", "Connection demand rises from 412 to 1,036; Aurora rejects new clients."],
              ["note", "Scaling clients into an exhausted shared dependency worsens the queue."]
            ]
          }
        ]
      }
    ]
  },
  {
    id: "db-postgres-migration-lock",
    title: "POSTGRES MIGRATION BLOCKING ORDERS",
    sev: "SEV2",
    tags: ["database", "deploy", "observability", "oncall"],
    weigh: 2,
    open: [
      ["said", "PagerDuty: [SEV2] order writes timing out in ca-central-1."],
      ["out", "Deploy pipeline reports ALTER TABLE orders ADD COLUMN running for 27 minutes."],
      ["out", "Write latency is 12.4s; 3,842 transactions are waiting."]
    ],
    hint: "Use pg_locks and pg_stat_activity to identify the blocker and its age. Cancel the migration before terminating application work.",
    steps: [
      {
        prompt: "Which query identifies the blocking transaction?",
        choices: [
          {
            label: "Join pg_locks to pg_stat_activity and inspect granted locks",
            pts: 10,
            min: 3,
            customers: 0,
            fixesCause: true,
            say: [
              ["cmd", "$ SELECT a.pid, a.query, l.mode, l.granted FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE NOT l.granted;"],
              ["out", "pid 28471 waits AccessExclusiveLock; pid 28109 holds ShareLock; age 27 min"],
              ["good", "The migration session is the blocker, not the database itself."],
              ["note", "Lock graphs reveal who waits and who holds; CPU graphs cannot answer that."]
            ]
          },
          {
            label: "Run EXPLAIN on the slowest order query",
            pts: 3,
            min: 5,
            customers: 0,
            fixesCause: false,
            say: [
              ["cmd", "$ EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders WHERE account_id = 9182;"],
              ["out", "Execution time: 12,401 ms; query waits behind AccessExclusiveLock."],
              ["warn", "The plan is healthy, but each diagnostic query joins the queue."],
              ["note", "Query tuning cannot remove a DDL lock that blocks every writer."]
            ]
          },
          {
            label: "Terminate every session waiting on the orders table",
            pts: -8,
            min: 4,
            customers: 19000,
            fixesCause: false,
            say: [
              ["cmd", "$ SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE wait_event_type = 'Lock';"],
              ["bad", "3,842 order transactions and 17 unrelated lock waiters are terminated."],
              ["warn", "The migration still holds AccessExclusiveLock and will retry its work."],
              ["note", "Waiting is not proof of culpability; terminate the blocker, not the victims."]
            ]
          }
        ]
      },
      {
        prompt: "What is the safest immediate remediation?",
        choices: [
          {
            label: "Cancel the migration backend, then verify locks clear",
            pts: 10,
            min: 3,
            customers: 0,
            fixesCause: true,
            say: [
              ["cmd", "$ SELECT pg_cancel_backend(28109);"],
              ["out", "pg_cancel_backend: t; AccessExclusiveLock released after 2 seconds"],
              ["good", "Write latency falls 12.4s -> 180ms; no application session was killed."],
              ["note", "Cancel the reversible DDL first; reschedule it with an online migration method."]
            ]
          },
          {
            label: "Fail over the primary during the order peak",
            pts: -9,
            min: 10,
            customers: 24000,
            fixesCause: false,
            say: [
              ["cmd", "$ aws rds reboot-db-instance --db-instance-identifier orders-primary --force-failover"],
              ["bad", "Failover takes 61 seconds; 24,000 writes fail and the migration resumes on retry."],
              ["note", "Failover moves the lock problem and adds a second outage during peak traffic."]
            ]
          },
          {
            label: "Add an index with CREATE INDEX CONCURRENTLY",
            pts: 2,
            min: 18,
            customers: 0,
            fixesCause: false,
            say: [
              ["cmd", "$ CREATE INDEX CONCURRENTLY orders_account_id_idx ON orders (account_id);"],
              ["out", "CREATE INDEX waits for the same blocked transactions."],
              ["warn", "It may help a future plan, but it cannot release the current DDL lock."],
              ["note", "Choose the operation that changes the active failure mode, not a generally good index."]
            ]
          }
        ]
      }
    ]
  },
  {
    id: "db-dynamodb-hot-partition",
    title: "DYNAMODB HOT PARTITION THROTTLING",
    sev: "SEV3",
    tags: ["aws", "database", "observability", "cost"],
    weigh: 2,
    open: [
      ["said", "PagerDuty: [SEV3] session reads throttled for tournament traffic."],
      ["out", "DynamoDB ConsumedReadCapacityUnits is 48,000; throttled requests peak at 18%."],
      ["out", "Contributor Insights shows partition key event#2026-10-18 at 96% of reads."]
    ],
    hint: "Capacity cannot fix a single hot partition indefinitely. Confirm the key distribution, then shard the access pattern with a bounded fan-out.",
    steps: [
      {
        prompt: "Hot key or low capacity: what confirms it?",
        choices: [
          {
            label: "Inspect Contributor Insights for the top partition keys",
            pts: 9,
            min: 4,
            customers: 0,
            fixesCause: true,
            say: [
              ["cmd", "$ aws cloudwatch get-insight-rule-report --rule-name DynamoDB-ContributorInsights-Sessions --period 60 --metrics KeyspaceKeyCount"],
              ["out", "Top key event#2026-10-18: 96.1% of requests; throttled keys: 1"],
              ["good", "One logical key is concentrating traffic on one physical partition."],
              ["note", "Key distribution distinguishes a hot partition from a table-wide quota problem."]
            ]
          },
          {
            label: "Double the table's provisioned read capacity",
            pts: 2,
            min: 6,
            customers: 0,
            fixesCause: false,
            say: [
              ["cmd", "$ aws dynamodb update-table --table-name Sessions --provisioned-throughput ReadCapacityUnits=96000"],
              ["out", "Table capacity updated; throttles remain 17.6%."],
              ["warn", "The same key still maps to a hot partition while spend doubles."],
              ["note", "Table capacity is not a substitute for a balanced partition-key access pattern."]
            ]
          },
          {
            label: "Disable the throttling alarm until the tournament ends",
            pts: -7,
            min: 2,
            customers: 16000,
            fixesCause: false,
            say: [
              ["cmd", "$ aws cloudwatch disable-alarm-actions --alarm-names SessionsReadThrottle"],
              ["bad", "The alarm is quiet; 16,000 players continue receiving 400 responses."],
              ["note", "Silencing the instrument does not change the partition or the customer impact."]
            ]
          }
        ]
      },
      {
        prompt: "How do you remove the hot-key bottleneck safely?",
        choices: [
          {
            label: "Read from 16 salted keys and merge the bounded results",
            pts: 10,
            min: 15,
            customers: 0,
            fixesCause: true,
            say: [
              ["cmd", "$ aws dynamodb query --table-name Sessions --key-condition-expression 'pk = :pk' --expression-attribute-values '{\":pk\":{\"S\":\"event#2026-10-18#07\"}}'"],
              ["out", "16 parallel Query calls; each key stays below 3,200 reads/s."],
              ["good", "Throttles fall 18% -> 0.2%; p95 read latency is 420ms."],
              ["note", "A bounded salt spreads the load; cap fan-out and measure the merge latency."]
            ]
          },
          {
            label: "Add 100 more application workers to drain reads faster",
            pts: -8,
            min: 8,
            customers: 12000,
            fixesCause: false,
            say: [
              ["cmd", "$ kubectl -n prod scale deploy/session-api --replicas=140"],
              ["bad", "Workers issue more reads to the same hot key; throttling rises to 34%."],
              ["note", "Scaling callers into a partition bottleneck increases contention, not throughput."]
            ]
          },
          {
            label: "Add exponential backoff without changing the partition key",
            pts: 4,
            min: 6,
            customers: 5000,
            fixesCause: false,
            say: [
              ["cmd", "$ aws dynamodb update-table --table-name Sessions --billing-mode PAY_PER_REQUEST"],
              ["out", "Retries use exponential backoff; throttles fall to 9.3%."],
              ["warn", "Backoff reduces pressure but adds 1.8s p95 latency and leaves one hot key."],
              ["note", "Backoff is a useful guardrail, not a repair for skewed key distribution."]
            ]
          }
        ]
      }
    ]
  }
];
