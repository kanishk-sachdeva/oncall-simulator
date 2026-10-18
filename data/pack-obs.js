export const pack = [
  {
    id: "obs-nat-egress-cost-spike",
    title: "NAT DATA PROCESSING COST SPIKE",
    sev: "SEV2",
    tags: ["aws", "cost", "network", "observability"],
    weigh: 2,
    open: [
      ["said", "FinOps pager: projected spend is $18,420 today; daily baseline is $2,140."],
      ["out", "Billing dashboard: NAT Gateway data processing is $1,184 in the last hour."],
      ["said", "Release bot: image-resizer 2026.10.18 deployed to prod 23 minutes ago."]
    ],
    hint: "Find the billing line item and map bytes to a workload before changing limits. NAT processing charges follow bytes, not instance count.",
    steps: [
      {
        prompt: "What do you inspect first?",
        choices: [
          {
            label: "Run Cost Explorer grouped by usage type for the last 24 hours",
            pts: 10, min: 3, customers: 0, fixesCause: false,
            say: [["cmd", "$ aws ce get-cost-and-usage --time-period Start=2026-10-17,End=2026-10-19 --granularity HOURLY --metrics UnblendedCost --group-by Type=USAGE_TYPE"], ["out", "NatGateway-Bytes: 41,209,884,672; UnblendedCost: 1184.22 USD"], ["good", "The cost is in the line item, with 41.2 GB processed in one hour."], ["note", "Cost investigation starts with usage and amount, not a resource list."]]
          },
          {
            label: "Raise the FinOps budget threshold to $20,000 for the day",
            pts: -8, min: 2, customers: 0, fixesCause: false,
            say: [["cmd", "$ aws budgets update-budget --budget-name prod-daily --budget-limit Amount=20000,Unit=USD"], ["out", "Budget prod-daily updated; forecast alert state is OK"], ["bad", "The alert is quiet, but NAT processing continues at $1,184 per hour."], ["note", "Changing the alarm hides the reading; it does not stop the bytes or spend."]]
          },
          {
            label: "List every NAT gateway and reboot the busiest one",
            pts: 2, min: 8, customers: 18000, fixesCause: false,
            say: [["cmd", "$ aws ec2 describe-nat-gateways --filter Name=state,Values=available"], ["out", "NatGatewayId nat-07ab: BytesOutToDestination 39.8 GB in 60 minutes"], ["warn", "A reboot interrupts 18,000 sessions while the workload can recreate the traffic."], ["note", "Resource inventory is useful context, not proof of the charged workload."]]
          }
        ]
      },
      {
        prompt: "How do you stop the recurring transfer?",
        choices: [
          {
            label: "Throttle image-resizer and route its S3 traffic through a gateway endpoint",
            pts: 10, min: 9, customers: 900, fixesCause: true,
            say: [["cmd", "$ kubectl -n media scale deploy/image-resizer --replicas=2; aws ec2 create-vpc-endpoint --service-name com.amazonaws.ca-central-1.s3"], ["out", "image-resizer requests: 1,920 -> 410 per minute; S3 route uses vpce-0c31"], ["good", "NAT bytes fall from 41.2 GB/hour to 0.7 GB/hour; projected daily cost is $2,310."], ["note", "Reduce the producer and remove same-region S3 traffic from the metered path."]]
          },
          {
            label: "Scale image-resizer to 40 replicas to finish the backlog",
            pts: -7, min: 4, customers: 1200, fixesCause: false,
            say: [["cmd", "$ kubectl -n media scale deploy/image-resizer --replicas=40"], ["out", "deployment.apps/image-resizer scaled; NAT bytes now 96.4 GB/hour"], ["bad", "The backlog drains faster, but projected spend rises above $40,000."], ["note", "Scaling into a metered shared dependency multiplies the cost anomaly."]]
          },
          {
            label: "Block all outbound traffic from the media namespace with a network policy",
            pts: 3, min: 6, customers: 15000, fixesCause: false,
            say: [["cmd", "$ kubectl -n media apply -f deny-egress.yaml"], ["out", "networkpolicy.networking.k8s.io/deny-egress configured"], ["warn", "Upload callbacks fail for 15,000 customers; NAT bytes reach 0.1 GB/hour."], ["note", "A blanket block is a costly mitigation when the destination can be fixed precisely."]]
          }
        ]
      }
    ]
  },
  {
    id: "obs-kafka-poison-message-lag",
    title: "KAFKA CONSUMER LAG — BILLING",
    sev: "SEV1",
    tags: ["queue", "database", "observability", "oncall"],
    weigh: 3,
    open: [
      ["said", "PagerDuty: billing-events consumer lag is 2.8 million records; checkout confirms payment delays."],
      ["out", "Kafka broker health: 3/3 online; topic billing-events has 12 partitions."],
      ["said", "Consumer log: deserialization failed at offset 9182441: invalid currency code CADX."]
    ],
    hint: "Describe the group before restarting it. Isolate the poison record, preserve offsets, and make rejection observable.",
    steps: [
      {
        prompt: "What is your first queue action?",
        choices: [
          {
            label: "Describe the billing-writer consumer group and partition lag",
            pts: 10, min: 3, customers: 0, fixesCause: false,
            say: [["cmd", "$ kafka-consumer-groups --bootstrap-server kafka.prod:9092 --describe --group billing-writer"], ["out", "billing-writer 7 9182441 11982441 2,000,000 billing-3"], ["good", "One partition is stuck at the malformed record while the group remains assigned."], ["note", "Consumer-group state identifies the blast radius before a disruptive action."]]
          },
          {
            label: "Restart every billing consumer so the group catches up together",
            pts: -9, min: 5, customers: 22000, fixesCause: false,
            say: [["cmd", "$ kubectl -n billing rollout restart deploy/billing-writer"], ["out", "group is PreparingRebalance; 12 members revoked partitions"], ["bad", "Lag rises to 3.4 million during the rebalance and the poison record remains."], ["note", "Restarting mid-rebalance adds downtime without changing the failing input."]]
          },
          {
            label: "Increase consumer concurrency to 96 and watch the lag chart",
            pts: 3, min: 4, customers: 8000, fixesCause: false,
            say: [["cmd", "$ kubectl -n billing scale deploy/billing-writer --replicas=96"], ["out", "consumer group has 96 members; 84 members have no assigned partitions"], ["warn", "The stuck partition cannot run in parallel, while database connections increase."], ["note", "More consumers cannot bypass one ordered poison record."]]
          }
        ]
      },
      {
        prompt: "How do you recover the partition safely?",
        choices: [
          {
            label: "Quarantine offset 9182441 to the DLQ, commit past it, and alert on DLQ depth",
            pts: 10, min: 12, customers: 120, fixesCause: true,
            say: [["cmd", "$ billing-replay quarantine --topic billing-events --partition 7 --offset 9182441 --dlq billing-events-dlq"], ["out", "DLQ append OK; committed offset 9182442 for billing-writer partition 7"], ["good", "Lag falls to 14,220 and valid billing events resume processing."], ["note", "Reject one malformed record, retain it for repair, and make rejection measurable."]]
          },
          {
            label: "Purge billing-events with kafka-delete-records --offset-json and recreate it",
            pts: -10, min: 8, customers: 60000, fixesCause: false,
            say: [["cmd", "$ kafka-delete-records --bootstrap-server kafka.prod:9092 --offset-json billing-events-all.json"], ["out", "Delete records accepted for 12 partitions"], ["bad", "Valid unpaid invoices vanish with the poison record; replay has no source."], ["note", "Purging a queue destroys evidence and good work to remove one bad message."]]
          },
          {
            label: "Skip offset 9182441 manually and add a dashboard annotation",
            pts: 5, min: 7, customers: 120, fixesCause: false,
            say: [["cmd", "$ kafka-consumer-groups --bootstrap-server kafka.prod:9092 --group billing-writer --reset-offsets --to-offset 9182442 --topic billing-events:7 --execute"], ["out", "billing-events:7 offset moved to 9182442; lag is 14,220"], ["warn", "The record is skipped but no durable DLQ copy exists for reconciliation."], ["note", "A fast offset move limits impact, but recovery needs preserved input and review."]]
          }
        ]
      }
    ]
  },
  {
    id: "obs-metrics-pipeline-silent",
    title: "METRICS PIPELINE SILENT",
    sev: "SEV3",
    tags: ["observability", "comms", "security", "aws"],
    weigh: 2,
    open: [
      ["said", "Slack: three services report elevated latency, but no alerts fired for 31 minutes."],
      ["out", "Prometheus UI: last sample 31m ago; Alertmanager shows 0 active alerts."],
      ["said", "Status page: operational. Customer support has four unlinked timeout tickets."]
    ],
    hint: "Test the monitoring path itself and communicate the blind spot. Restore telemetry before trusting green dashboards.",
    steps: [
      {
        prompt: "How do you confirm the blind spot?",
        choices: [
          {
            label: "Probe Prometheus readiness and query the up metric",
            pts: 10, min: 4, customers: 0, fixesCause: false,
            say: [["cmd", "$ curl -fsS https://prometheus.prod/-/ready; promtool query instant http://prometheus.prod up"], ["out", "curl: (28) Operation timed out; promtool: context deadline exceeded"], ["good", "The telemetry reader is unavailable, so green alerts are not evidence of health."], ["note", "Probe the artifact that serves alerts, not only the application dashboard."]]
          },
          {
            label: "Raise every latency alert threshold to stop the silent period",
            pts: -8, min: 3, customers: 0, fixesCause: false,
            say: [["cmd", "$ amtool silence add alertname=HighLatency --comment='noisy'"], ["out", "Silence created: 3d8f7e; 0 alerts will notify during the outage"], ["bad", "The broken metrics path stays broken and real customer impact remains undisclosed."], ["note", "Silencing an absent instrument removes a signal you already cannot verify."]]
          },
          {
            label: "Check only the checkout pod logs and close the observability ticket",
            pts: 2, min: 5, customers: 0, fixesCause: false,
            say: [["cmd", "$ kubectl -n checkout logs deploy/checkout-api --since=10m | tail -n 20"], ["out", "request timeout: 4,812; metrics exporter: 0 errors"], ["warn", "Application logs show damage, but they do not explain why monitoring stopped."], ["note", "A healthy exporter log line is not proof that samples reach the alert evaluator."]]
          }
        ]
      },
      {
        prompt: "What do you do while telemetry is restored?",
        choices: [
          {
            label: "Page the lead, post status, and route synthetic checks to Slack",
            pts: 10, min: 6, customers: 4200, fixesCause: true,
            say: [["cmd", "$ curl -X POST https://status.example/api/incidents -d 'name=metrics blind spot&status=investigating'"], ["out", "incident 2026-10-18-obs created; synthetic checkout p95 is 4.8s"], ["said", "Status page: Investigating elevated checkout latency; next update in 20 minutes."], ["note", "Communicate the monitoring failure and use an independent signal until alerts are trustworthy."]]
          },
          {
            label: "Tell nobody until Prometheus is healthy and then backfill the status page",
            pts: -7, min: 4, customers: 4200, fixesCause: false,
            say: [["cmd", "$ kubectl -n monitoring rollout status deploy/prometheus"], ["out", "deployment exceeded its progress deadline after 10 minutes"], ["bad", "Customers receive no update for 40 minutes while support repeats an operational message."], ["note", "A communications gap is an incident multiplier; do not wait for internal certainty to disclose impact."]]
          },
          {
            label: "Restart the entire monitoring namespace and wait for dashboards to turn green",
            pts: 3, min: 10, customers: 900, fixesCause: false,
            say: [["cmd", "$ kubectl -n monitoring delete pod --all"], ["out", "14 pods deleted; scrape coverage is 0% for 7 minutes"], ["warn", "The restart creates a second blind interval and still has no confirmed cause."], ["note", "Restore the failed dependency deliberately; broad restarts erase useful evidence."]]
          }
        ]
      }
    ]
  }
];
