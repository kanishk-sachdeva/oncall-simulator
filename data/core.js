// Core incident set — the six that shipped in v1, upgraded to the v2 schema.
// See CONTENT-SPEC.md for the field contract.

export const pack = [
  {
    id: "core-checkout-oom",
    title: "CHECKOUT 5XX — EU-WEST-1",
    sev: "SEV1",
    tags: ["k8s", "deploy", "comms"],
    weigh: 3,
    open: [
      ["said", "PagerDuty: [SEV1] checkout-api error rate 8.2% (baseline 0.05%). 6 min and counting."],
      ["out", "Last deploy: checkout-api v2.14.1, 12 minutes ago."],
      ["out", "Revenue impact is live. Everyone is awake because of you."]
    ],
    hint: "A deploy 12 minutes before an error-rate cliff is the hypothesis until something else disproves it. Look at the artifact before you touch the cluster.",
    steps: [
      {
        prompt: "First move?",
        choices: [
          {
            label: "kubectl rollout undo deploy/checkout-api -n prod",
            pts: 7, min: 2, customers: 40000, fixesCause: false,
            say: [
              ["cmd", "$ kubectl rollout undo deploy/checkout-api -n prod"],
              ["out", "deployment.apps/checkout-api rolled back"],
              ["good", "Error rate 8.2% -> 0.1% in 90 seconds. Customers stop bleeding."],
              ["note", "Right instinct, incomplete job: the bad image is still in the registry and you just deleted the containers you needed to inspect."]
            ]
          },
          {
            label: "kubectl get pods, then describe the one that keeps dying",
            pts: 9, min: 4, customers: 0, fixesCause: false,
            say: [
              ["cmd", "$ kubectl get pods -n prod | grep checkout"],
              ["out", "checkout-api-7d9f4b-2xk9m   0/1   CrashLoopBackOff   6   4m12s"],
              ["cmd", "$ kubectl describe pod checkout-api-7d9f4b-2xk9m | tail -5"],
              ["out", "Last State: Terminated  Reason: OOMKilled  Exit 137  Limit 512Mi / peak 1.4Gi"],
              ["good", "You know what broke before you touched anything. That is the whole job."],
              ["note", "v2.14.1 added a 900MB in-memory cache under an unchanged 512Mi limit."]
            ]
          },
          {
            label: "kubectl delete pods --all -n prod",
            pts: -12, min: 18, customers: 240000, fixesCause: false,
            say: [
              ["cmd", "$ kubectl delete pods --all -n prod"],
              ["bad", "147 pods terminated across every service in the namespace, not just checkout."],
              ["bad", "New pods come up on the same bad config. Error rate 8.2% -> 61%."],
              ["note", "Never reach for --all during an incident. Blast radius is a choice you make before you type."]
            ]
          },
          {
            label: "Post in the incident channel and wait for a second pair of eyes",
            pts: -9, min: 22, customers: 90000, fixesCause: false,
            say: [
              ["out", "22 minutes pass. 8.2% holds steady. Nobody replies — it is 02:11."],
              ["bad", "An auto-rollback on the error-rate alarm would have handled this 20 minutes ago. That is a platform gap, not a you gap."],
              ["note", "At two in the morning, you are the second pair of eyes. Escalate after mitigation, not before."]
            ]
          }
        ]
      },
      {
        prompt: "Traffic is normal again. What now?",
        choices: [
          {
            label: "Freeze the image in the pipeline and open a ticket with the OOM evidence",
            pts: 9, min: 6, customers: 0, fixesCause: true,
            say: [
              ["cmd", "$ gh workflow disable deploy-checkout.yml"],
              ["out", "checkout-api v2.14.1 yanked from the release train."],
              ["good", "Cause contained. The ticket carries the describe output, the commit, and the limit diff."],
              ["note", "This is the line between mitigating and fixing."]
            ]
          },
          {
            label: "Raise the limit to 2Gi and redeploy 2.14.1 right away",
            pts: 3, min: 14, customers: 8000, fixesCause: true,
            say: [
              ["out", "v2.14.1 ships with memory=2Gi. No more OOMKills tonight."],
              ["warn", "It holds — but you shipped an untested config at 02:40 to a service that just broke."],
              ["note", "The cache is still unbounded. 2Gi is a bigger runway, not a fix."]
            ]
          },
          {
            label: "Mark it resolved and go back to bed — it is green",
            pts: -7, min: 5, customers: 0, fixesCause: false,
            say: [
              ["bad", "Closed as resolved. The bad image stayed in the pipeline and shipped again at 09:00 to the same result."],
              ["note", "Resolved means the cause is gone, not the symptom. This set up someone else's Friday."]
            ]
          }
        ]
      },
      {
        prompt: "Your lead wants a number. What do you send?",
        choices: [
          {
            label: "Cause, mitigation, artifact — three lines",
            pts: 9, min: 3, customers: 0, fixesCause: false,
            say: [
              ["said", "you: Fixed. OOM from the 2.14.1 cache. Rolled back, image frozen, ticket has the describe output."],
              ["good", "Zero guessing, nothing to follow up on. Whoever wakes up next can act on it."]
            ]
          },
          {
            label: "Should be sorted now, will keep an eye on it",
            pts: 2, min: 3, customers: 0, fixesCause: false,
            say: [
              ["said", "lead: what was it?"],
              ["note", "Vague updates cost a round trip every single time."]
            ]
          },
          {
            label: "Nothing yet, still investigating",
            pts: -6, min: 10, customers: 0, fixesCause: false,
            say: [
              ["bad", "You already fixed it, and you told your lead you had nothing."],
              ["note", "Under-reporting burns the same trust as over-reporting."]
            ]
          }
        ]
      }
    ]
  },

  {
    id: "core-node-notready",
    title: "NODE NOTREADY — 1 OF 6",
    sev: "SEV2",
    tags: ["k8s", "aws", "observability"],
    weigh: 2,
    open: [
      ["said", "Alertmanager: ip-10-0-4-77 NotReady for 4m. 34 pods scheduled on it."],
      ["out", "Node age 61 days. Disk usage was 71% at the last scrape."],
      ["out", "Capacity check: the nodegroup still has headroom for 34 pods, just."]
    ],
    hint: "A NotReady node gives you two jobs at once: get the workloads off it, and find out why it will happen to the next one.",
    steps: [
      {
        prompt: "What do you check first?",
        choices: [
          {
            label: "kubectl describe node — conditions and events",
            pts: 9, min: 3, customers: 0, fixesCause: false,
            say: [
              ["cmd", "$ kubectl describe node ip-10-0-4-77 | grep -A6 Conditions"],
              ["out", "MemoryPressure   True"],
              ["out", "DiskPressure     True   (imagefs 91%, kubelet evicting)"],
              ["out", "Events: Eviction manager evicting pods; FailedMount on 2 volumes"],
              ["good", "One command, the whole story: image garbage collection stopped collecting."]
            ]
          },
          {
            label: "Cordon and drain the node immediately",
            pts: 6, min: 12, customers: 4000, fixesCause: false,
            say: [
              ["cmd", "$ kubectl drain ip-10-0-4-77 --ignore-daemonsets --delete-emptydir-data"],
              ["out", "34 pods rescheduled in 11 minutes. Two 502 blips on the way through."],
              ["warn", "Safe, and you still do not know why. The next node will do exactly the same thing."],
              ["note", "Draining is recovery. Diagnosing is prevention. Try to get both in one night."]
            ]
          },
          {
            label: "kubectl delete node and let the autoscaler replace it",
            pts: -8, min: 25, customers: 12000, fixesCause: false,
            say: [
              ["bad", "Deleting the Node object orphans the EC2 instance. The ASG launches a replacement, and the old one keeps running."],
              ["bad", "You now have a zombie instance billing you and invisible to kubectl."],
              ["note", "Terminate the instance, then let the Node object go. In that order."]
            ]
          }
        ]
      },
      {
        prompt: "Logs filled the disk and image GC never fired. Your fix?",
        choices: [
          {
            label: "Fix rotation in the sidecar and the nodegroup template",
            pts: 9, min: 9, customers: 0, fixesCause: true,
            say: [
              ["out", "Rotation set to 50MB x 5. Thresholds reviewed against the real imagefs size."],
              ["good", "Two bugs, two fixes, and the template means the replacement nodes have them too."]
            ]
          },
          {
            label: "SSH in, delete the logs, move on",
            pts: -7, min: 7, customers: 0, fixesCause: false,
            say: [
              ["cmd", "$ ssh core@ip-10-0-4-77 ; sudo rm -rf /var/log/pods/*"],
              ["out", "Node goes Ready in 40 seconds. Beautiful. Temporary."],
              ["bad", "Nothing is recorded, no capacity changed, and the fleet still has the config. Three more nodes will do this next week."],
              ["note", "A fix that evaporates with the node is not a fix."]
            ]
          },
          {
            label: "Give every node a bigger EBS volume",
            pts: 1, min: 8, customers: 0, fixesCause: false,
            say: [
              ["out", "You bought time, and 40GB x 20 nodes of storage."],
              ["note", "Capacity is not a substitute for rotation. The alert returns in about five weeks."]
            ]
          }
        ]
      }
    ]
  },

  {
    id: "core-pool-exhausted",
    title: "P99 LATENCY — CONNECTION POOL EXHAUSTED",
    sev: "SEV1",
    tags: ["database", "observability"],
    weigh: 2,
    open: [
      ["said", "PagerDuty: [SEV1] api-gateway p99 4.8s (SLO 800ms). Error rate unchanged."],
      ["out", "Nothing deployed in 9 days. Nobody touched the database."],
      ["out", "Postgres: 197 active connections of max 200."]
    ],
    hint: "The pool being full is a symptom with two possible parents: the consumers, or the thing they are waiting on. Ask the database who is holding what.",
    steps: [
      {
        prompt: "The pool is maxed. Your move?",
        choices: [
          {
            label: "Find who is holding connections — pg_stat_activity by state",
            pts: 10, min: 4, customers: 0, fixesCause: false,
            say: [
              ["cmd", "$ SELECT state, count(*), max(now()-state_change) FROM pg_stat_activity GROUP BY 1;"],
              ["out", "idle in transaction | 118 | 41 minutes"],
              ["out", "idle               |  61 | 2 minutes"],
              ["cmd", "$ SELECT query FROM pg_stat_activity WHERE state='idle in transaction' LIMIT 1;"],
              ["out", "SELECT * FROM offers WHERE id = $1   -- transaction never committed"],
              ["good", "118 sessions idle mid-transaction for 41 minutes. That is a leaked transaction, not a capacity problem."]
            ]
          },
          {
            label: "Raise max_connections to 500 and restart the database",
            pts: -14, min: 35, customers: 210000, fixesCause: false,
            say: [
              ["bad", "Restarting the primary takes every tenant down for six minutes at 04:02."],
              ["bad", "500 connections on 4 vCPU makes p99 worse — the box now context-switches for a living."],
              ["note", "Adding connections to a saturated CPU turns a slow system into a dead one."]
            ]
          },
          {
            label: "Scale the API from 12 pods to 40",
            pts: -6, min: 10, customers: 60000, fixesCause: false,
            say: [
              ["out", "60 more pods, 140 more connection attempts against a 200-connection ceiling."],
              ["bad", "Now 40 pods time out instead of 12. p99 4.8s -> 9.1s."],
              ["note", "Never scale into a shared dependency bottleneck. Remove the leak first."]
            ]
          }
        ]
      },
      {
        prompt: "Found it: a leaked transaction on early return. Tonight?",
        choices: [
          {
            label: "Terminate idle sessions, hotfix the commit, add a timeout",
            pts: 10, min: 22, customers: 0, fixesCause: true,
            say: [
              ["cmd", "$ SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='idle in transaction' AND state_change < now()-interval '5 min';"],
              ["out", "118 sessions released. p99 4.8s -> 620ms."],
              ["good", "Blast radius is one code path, the flag rolls it back, and the timeout makes the next leak harmless."],
              ["note", "Stop the bleeding, contain it, then make the failure mode boring."]
            ]
          },
          {
            label: "Terminate the idle transactions and go to bed",
            pts: 2, min: 8, customers: 0, fixesCause: false,
            say: [
              ["out", "p99 recovers to 620ms. The latency graph looks great at 04:30."],
              ["bad", "The leak refills the pool in 41 minutes. You are paged again at 05:11."],
              ["note", "Killing the symptom buys twenty minutes. It does not buy a night's sleep."]
            ]
          },
          {
            label: "Roll back the unrelated release from nine days ago",
            pts: -7, min: 30, customers: 45000, fixesCause: false,
            say: [
              ["bad", "A nine-day-old release does not explain a forty-minute-old leak. Latency is unchanged and now you have two variables."],
              ["note", "Correlation is not causation, and 'the last thing anyone touched' is a bad hypothesis generator."]
            ]
          }
        ]
      }
    ]
  },

  {
    id: "core-tls-expired",
    title: "TLS CERT EXPIRED — PARTNER INTEGRATIONS",
    sev: "SEV2",
    tags: ["tls", "network", "comms"],
    weigh: 1,
    open: [
      ["said", "Slack: partner support reports 100% failure on the mTLS endpoint. Effective 05:38."],
      ["out", "cert-manager reports the Certificate as READY. It is not."],
      ["out", "cert-manager version v1.11. Days since the last renewal: 14."]
    ],
    hint: "Configured objects and served artifacts are two different things. Monitor and inspect what leaves the process, not what you told it to do.",
    steps: [
      {
        prompt: "cert-manager says READY. The cert is expired. Verify what?",
        choices: [
          {
            label: "openssl s_client against the live endpoint",
            pts: 9, min: 3, customers: 0, fixesCause: false,
            say: [
              ["cmd", "$ echo | openssl s_client -connect api.example.com:443 2>/dev/null | openssl x509 -noout -dates -subject"],
              ["out", "notAfter=Jun  9 05:38:00 2026 GMT"],
              ["out", "subject=CN=*.legacy-internal.svc"],
              ["good", "The live endpoint is serving an old wildcard, not the managed certificate. cert-manager is fine; the Service points at the wrong secret."]
            ]
          },
          {
            label: "Request a new certificate and apply the secret by hand",
            pts: 4, min: 12, customers: 2000, fixesCause: false,
            say: [
              ["out", "New cert issued, secret updated by hand, endpoint recovers."],
              ["warn", "It recovers — but the Service still references the old secret name, so tomorrow's renewal breaks it again."],
              ["note", "Manual certificate distribution is a job you just signed up to do forever."]
            ]
          },
          {
            label: "Restart cert-manager and wait",
            pts: -6, min: 15, customers: 30000, fixesCause: false,
            say: [
              ["out", "cert-manager restarts cleanly. Certificate still READY. Endpoint still expired."],
              ["bad", "Fifteen minutes spent diagnosing a component that was never broken."],
              ["note", "Restart-on-doubt is a coin flip with a fifteen-minute price tag."]
            ]
          }
        ]
      },
      {
        prompt: "How do you make this unrepeatable?",
        choices: [
          {
            label: "Serve the managed secret, and alert at 30/14/7/1 days before expiry",
            pts: 10, min: 16, customers: 0, fixesCause: true,
            say: [
              ["out", "ingress default-ssl-certificate -> the cert-manager secret."],
              ["out", "New rule: certmanager_certificate_expiration_timestamp_seconds < 14 days."],
              ["good", "The failure mode moves from 'partners notice' to 'a dashboard noticed two weeks ago'."],
              ["note", "Monitor the artifact you serve, and alert before the cliff rather than at it."]
            ]
          },
          {
            label: "Write it up in the runbook",
            pts: 2, min: 12, customers: 0, fixesCause: false,
            say: [
              ["out", "Runbook section added: 'if partners report TLS failures, check the secret name'."],
              ["note", "Documentation is how a human catches this. Automation is how nobody has to."]
            ]
          },
          {
            label: "Calendar reminder for 90 days",
            pts: -6, min: 5, customers: 0, fixesCause: false,
            say: [
              ["bad", "Same human, same night, same surprise — unless the next renewal happens to work."],
              ["note", "The calendar reminder is the alert you built when you did not want to build an alert."]
            ]
          }
        ]
      }
    ]
  },

  {
    id: "core-cost-nat",
    title: "COST ANOMALY — 3X NIGHTLY BURN",
    sev: "SEV3",
    tags: ["cost", "aws", "observability"],
    weigh: 2,
    open: [
      ["said", "AWS Budgets: forecast 214% of monthly budget. Current burn is 3x the 30-day baseline."],
      ["out", "No traffic increase. Nothing new deployed this week."]
    ],
    hint: "Cost work is the same discipline as incident work: find the line item before you touch the resource list.",
    steps: [
      {
        prompt: "Where does the money go?",
        choices: [
          {
            label: "Cost Explorer grouped by service and usage type, 3 days vs prior week",
            pts: 9, min: 5, customers: 0, fixesCause: false,
            say: [
              ["cmd", "$ aws ce get-cost-and-usage --granularity DAILY --group-by Type=DIMENSION,Key=SERVICE"],
              ["out", "EC2-Other:        +$1,840/day"],
              ["out", "NatGateway-Bytes: +$1,610/day"],
              ["out", "NAT processed 41 TB overnight. Baseline: 0.4 TB."],
              ["good", "41 TB through a NAT gateway at $0.045/GB. Something is shipping data in a loop."]
            ]
          },
          {
            label: "Terminate the biggest EC2 instances to stop the spend",
            pts: -12, min: 20, customers: 150000, fixesCause: false,
            say: [
              ["bad", "You killed three production instances to save $60/day while $1,840/day of data transfer kept flowing."],
              ["bad", "Service degradation plus no savings. Worst of both."],
              ["note", "Deleting resources before reading the line item is how you get a second incident."]
            ]
          },
          {
            label: "Set a billing alarm and raise it in standup",
            pts: -5, min: 4, customers: 0, fixesCause: false,
            say: [
              ["out", "Standup is in four hours. At this rate that is another $300."],
              ["note", "Billing alarms are for the next person. You have an active bleed right now."]
            ]
          }
        ]
      },
      {
        prompt: "A shipper polls S3 over the internet, not the VPC. Close it?",
        choices: [
          {
            label: "Attach the S3 gateway endpoint, deny internet S3, alarm NAT bytes",
            pts: 10, min: 18, customers: 0, fixesCause: true,
            say: [
              ["out", "Gateway endpoint attached to 9 route tables. Next day: -$1,590/day."],
              ["good", "Structural: the traffic physically cannot leave the VPC even if config drifts back."],
              ["note", "NAT data processing is one of the most common surprise line items in AWS. Free to prevent, expensive to notice."]
            ]
          },
          {
            label: "Fix the shipper config to use the endpoint URL",
            pts: 4, min: 10, customers: 0, fixesCause: false,
            say: [
              ["out", "Spend drops to baseline."],
              ["warn", "Nothing stops the next misconfiguration. The VPC still cannot tell in-VPC S3 traffic from internet S3 traffic."]
            ]
          },
          {
            label: "Raise the budget threshold so the alert stops firing",
            pts: -10, min: 3, customers: 0, fixesCause: false,
            say: [
              ["bad", "The alert goes quiet. The bill does not."],
              ["note", "Never silence the instrument to fix the reading."]
            ]
          }
        ]
      }
    ]
  },

  {
    id: "core-retry-storm",
    title: "THE RETRY STORM",
    sev: "SEV2",
    tags: ["network", "deploy", "observability"],
    weigh: 2,
    open: [
      ["said", "SEV2: recommendation-svc timeouts. Callers retrying. Request volume 40x baseline, success rate steady."],
      ["out", "Every caller has retries.maxAttempts = 5, no jitter, no circuit breaker."],
      ["out", "recommendation-svc is up, healthy and slow. It is drowning in kindness."]
    ],
    hint: "A retry storm scales with your callers' patience, not with your replica count. Ask whether you want to absorb it or refuse it.",
    steps: [
      {
        prompt: "The service is healthy but buried. What stops the storm?",
        choices: [
          {
            label: "Shed load at the edge — 429 with Retry-After, keep a golden-signals path open",
            pts: 9, min: 9, customers: 30000, fixesCause: false,
            say: [
              ["cmd", "$ kubectl apply -f ingress-ratelimit.yaml   # 429 + Retry-After: 5"],
              ["out", "Attempt volume 40x -> 3.2x. recommendation-svc recovers in 4 minutes."],
              ["good", "Deliberate, visible rejection beats an unbounded queue and a silent timeout."]
            ]
          },
          {
            label: "Disable retries cluster-wide right now",
            pts: 5, min: 7, customers: 12000, fixesCause: false,
            say: [
              ["out", "Attempt volume collapses. Success rate dips too, because you also killed the legitimate retries."],
              ["warn", "Blunt but effective. It hides the next real error behind a single attempt."],
              ["note", "Better than nothing, worse than shedding load on purpose."]
            ]
          },
          {
            label: "Scale recommendation-svc to 60 replicas",
            pts: -7, min: 15, customers: 20000, fixesCause: false,
            say: [
              ["out", "60 replicas come up and immediately receive the same 40x retry volume."],
              ["bad", "You bought capacity for a workload that does not exist. Cost 5x, attempt volume unchanged."],
              ["note", "Autoscaling absorbs a real spike. It does not fix a feedback loop."]
            ]
          }
        ]
      },
      {
        prompt: "Storm is over. What prevents the sequel?",
        choices: [
          {
            label: "Jittered backoff, a circuit breaker per caller, a retry budget",
            pts: 10, min: 20, customers: 0, fixesCause: true,
            say: [
              ["out", "jitter: full, base: 200ms, cap: 4s, breaker: 50% errors over 20s, budget: 10% of requests."],
              ["out", "Shared library updated. 14 services pick it up on their next deploy."],
              ["good", "Retries become bounded behaviour instead of an emergent denial-of-service against yourself."]
            ]
          },
          {
            label: "Add replicas and raise the autoscaling ceiling",
            pts: 0, min: 10, customers: 0, fixesCause: false,
            say: [
              ["out", "Ceiling raised from 20 to 60. Cost up, behaviour unchanged."],
              ["note", "If the safe retry is not the default in the shared library, it is not the default."]
            ]
          },
          {
            label: "Ask every team to be more careful with retries",
            pts: -6, min: 8, customers: 0, fixesCause: false,
            say: [
              ["said", "three teams reply with a thumbs up. Two do not read the message."],
              ["note", "Culture is not a control. Make the safe thing the default in code."]
            ]
          }
        ]
      }
    ]
  },

  {
    id: "core-dashboard-lies",
    title: "THE DASHBOARD LIES",
    sev: "SEV2",
    tags: ["observability", "comms", "oncall"],
    weigh: 1,
    open: [
      ["said", "Customer: 'your app has been down for 20 minutes.' Your dashboards are green."],
      ["out", "Uptime probe: 200 OK. Error-rate panel: 0.02%. Latency: nominal."],
      ["out", "The synthetic check hits /health, which returns 200 without touching a dependency."]
    ],
    hint: "The health check is part of the system you have to trust. If it cannot fail, it cannot tell you anything.",
    steps: [
      {
        prompt: "The customer says you are down. The dashboards are green.",
        choices: [
          {
            label: "Reproduce the real user path — one request to the actual page, end to end",
            pts: 9, min: 4, customers: 0, fixesCause: false,
            say: [
              ["cmd", "$ curl -s -o /dev/null -w '%{http_code} %{time_total}s\\n' 'https://app.example.com/quote?zip=M5V'"],
              ["out", "502   0.31s"],
              ["out", "and /health is still 200 because it never calls pricing."],
              ["good", "The customer was right and the instrument was wrong. Both facts matter."],
              ["note", "A green dashboard on a broken product is worse than no dashboard: it is a confident wrong answer."]
            ]
          },
          {
            label: "Trust the dashboards and reply that everything looks healthy",
            pts: -11, min: 18, customers: 60000, fixesCause: false,
            say: [
              ["bad", "You told a paying customer they were mistaken for another 18 minutes."],
              ["bad", "When it turned out they were right, the trust cost more than the outage."],
              ["note", "Never argue with the customer using your own monitoring. The customer IS the monitoring."]
            ]
          },
          {
            label: "Restart the app pods to 'clear' it",
            pts: -5, min: 9, customers: 40000, fixesCause: false,
            say: [
              ["out", "Pods restart cleanly. The 502s stop for eleven minutes, then resume."],
              ["warn", "You reset the evidence and learned nothing."],
              ["note", "Restarting is not a diagnostic tool, it is an evidence shredder."]
            ]
          }
        ]
      },
      {
        prompt: "Pricing returned empty config, one path 502s. Fix it?",
        choices: [
          {
            label: "Check real dependencies in /health, add a synthetic user flow",
            pts: 10, min: 15, customers: 0, fixesCause: true,
            say: [
              ["out", "healthz now fails when pricing is unreachable. Synthetic flow covers search -> quote -> checkout."],
              ["good", "The next failure is announced by the system instead of by a customer."],
              ["note", "Monitor the journey, not the process. And fail the health check when a dependency is gone."]
            ]
          },
          {
            label: "Add an alert for 502s on the load balancer",
            pts: 5, min: 8, customers: 0, fixesCause: false,
            say: [
              ["out", "New alarm: 5xx > 1% for 5 minutes."],
              ["warn", "Good, and still weaker than testing the thing the customer does."],
              ["note", "An alarm on a symptom is a lagging indicator. A synthetic on the journey is a leading one."]
            ]
          }
        ]
      }
    ]
  },

  {
    id: "core-statuspage-comms",
    title: "NOBODY TOLD THE CUSTOMERS",
    sev: "SEV2",
    tags: ["comms", "oncall", "observability"],
    weigh: 1,
    open: [
      ["said", "Support inbox: 340 tickets. Status page: 'All systems operational'."],
      ["out", "The incident is 52 minutes old. The last customer-facing update was never."],
      ["out", "You have been heads-down fixing it, which is correct, and also the problem."]
    ],
    hint: "Comms is part of the incident, not a follow-up to it. A stale status page turns a technical failure into a trust failure.",
    steps: [
      {
        prompt: "52 minutes in, no update. What do you do?",
        choices: [
          {
            label: "Post an interim update now: impact, scope, next update time",
            pts: 9, min: 4, customers: 0, fixesCause: false,
            say: [
              ["said", "status: We are investigating elevated errors on quote and checkout (14:02 UTC). Next update by 14:30."],
              ["good", "Support now answers tickets with the same words you are using. Impact, scope, a promised next update."],
              ["note", "An update is not a fix and does not need to be. It is a promise you keep."]
            ]
          },
          {
            label: "Keep working — you will post a full write-up when it is fixed",
            pts: -7, min: 20, customers: 0, fixesCause: false,
            say: [
              ["bad", "Another 20 minutes of silence. Support keeps guessing, customers keep escalating to their account managers."],
              ["note", "Silence is read as 'they do not know'. Nobody expects you to be done; they expect you to be honest."]
            ]
          },
          {
            label: "Hand comms to the on-call lead and go back to the keyboard",
            pts: 7, min: 3, customers: 0, fixesCause: false,
            say: [
              ["out", "Comms IC owns the status page and the support channel. You own the system."],
              ["good", "Right split at scale. One person talking, one person typing."],
              ["note", "Single-threaded comms beats five engineers improvising an answer."]
            ]
          }
        ]
      }
    ]
  }
];
