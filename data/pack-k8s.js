export const pack = [
  {
    id: "k8s-imagefs-diskpressure",
    title: "NODE IMAGEFS DISKPRESSURE — EKS",
    sev: "SEV1",
    tags: ["k8s", "aws", "oncall"],
    weigh: 3,
    open: [
      ["said", "PagerDuty: [SEV1] 38% of checkout pods pending; node imagefs DiskPressure."],
      ["out", "kubectl get nodes: 7 NotReady, 11 Ready; kubelet eviction manager is active."],
      ["said", "Release lead: checkout latency is above 9 seconds in eu-west-1."],
      ["out", "CloudWatch: EBS gp3 burst balance 100%; imagefs is the constrained filesystem."]
    ],
    hint: "Confirm the kubelet condition and image filesystem before changing scheduling. Remove unused images safely, then replace unhealthy capacity.",
    steps: [
      {
        prompt: "What do you inspect before touching nodes?",
        choices: [
          {
            label: "kubectl describe node ip-10-42-7-19 and inspect DiskPressure events",
            pts: 10, min: 2, customers: 0, fixesCause: false,
            say: [["cmd", "$ kubectl describe node ip-10-42-7-19"], ["out", "Conditions: DiskPressure=True; Reason: KubeletHasDiskPressure"], ["out", "Events: imagefs.available 7%, threshold 10%; eviction manager: attempting to reclaim ephemeral-storage"], ["note", "Measure the constrained filesystem and eviction signal before choosing a remedy."]]
          },
          {
            label: "kubectl get pods -A -o wide and restart the largest checkout pods",
            pts: 3, min: 4, customers: 1200, fixesCause: false,
            say: [["cmd", "$ kubectl get pods -A -o wide"], ["out", "checkout-api pods restart; replacement pods remain Pending on the same nodes"], ["warn", "Restarts consume capacity while kubelet eviction still targets the node."], ["note", "A pod restart does not reclaim container images or node filesystem space."]]
          },
          {
            label: "kubectl delete node ip-10-42-7-19 to clear the condition",
            pts: -8, min: 3, customers: 8000, fixesCause: false,
            say: [["cmd", "$ kubectl delete node ip-10-42-7-19"], ["bad", "node ip-10-42-7-19 deleted; kubelet continues running and workloads are not drained"], ["bad", "Unmanaged pods keep their volumes while the autoscaler sees less inventory."], ["note", "Deleting the Node object hides status; it does not free disk or safely move workloads."]]
          }
        ]
      },
      {
        prompt: "How do you recover capacity without repeating eviction?",
        choices: [
          {
            label: "Drain one node, prune unused images, then replace the nodegroup instance",
            pts: 10, min: 18, customers: 0, fixesCause: true,
            say: [["cmd", "$ kubectl drain ip-10-42-7-19 --ignore-daemonsets --delete-emptydir-data"], ["out", "evicting pod checkout-api-6d7c; node/ip-10-42-7-19 drained"], ["cmd", "$ sudo crictl rmi --prune; aws autoscaling terminate-instance-in-auto-scaling-group ..."], ["good", "imagefs.available 7% -> 41%; DiskPressure=False; pending pods schedule on replacement capacity"], ["note", "Reclaiming images is temporary; replacing the contaminated node removes recurring local state."]]
          },
          {
            label: "kubectl cordon every node and wait for kubelet GC",
            pts: 2, min: 12, customers: 14000, fixesCause: false,
            say: [["cmd", "$ kubectl cordon -l kubernetes.io/os=linux"], ["out", "11 nodes cordoned; pending pods increase from 38 to 214"], ["warn", "Kubelet image GC may recover space, but cordoning the fleet blocks the recovery path."], ["note", "Limit the blast radius to one node; fleet-wide cordon turns pressure into an outage."]]
          },
          {
            label: "kubectl drain --force --delete-emptydir-data on the node",
            pts: -9, min: 6, customers: 9000, fixesCause: false,
            say: [["cmd", "$ kubectl drain ip-10-42-7-19 --force --delete-emptydir-data"], ["bad", "WARNING: ignoring DaemonSet-managed pods; deleting 6 local-data pods"], ["bad", "checkout workers lose ephemeral queue shards; 503s rise to 31%"], ["note", "Force drain bypasses ownership and can discard state; it is not imagefs remediation."]]
          }
        ]
      }
    ]
  },
  {
    id: "k8s-pdb-security-drain",
    title: "PDB BLOCKS SECURITY DRAIN — EKS",
    sev: "SEV2",
    tags: ["k8s", "security", "deploy", "oncall"],
    weigh: 2,
    open: [
      ["said", "PagerDuty: [SEV2] security patch rollout stalled; 3 worker nodes still on kernel 5.10."],
      ["out", "kubectl drain: cannot evict pod payments-api-7c8d; would violate disruption budget."],
      ["said", "Security: CVE patch window closes in 42 minutes; payments must stay available."],
      ["out", "PDB payments-api: minAvailable=3, currentHealthy=3, desiredHealthy=3, disruptionsAllowed=0."]
    ],
    hint: "A PDB protects availability during voluntary disruption. Check replica health and rollout capacity; do not bypass it with force.",
    steps: [
      {
        prompt: "What explains the blocked eviction?",
        choices: [
          {
            label: "kubectl get pdb payments-api -n prod -o yaml and check replicas",
            pts: 10, min: 3, customers: 0, fixesCause: false,
            say: [["cmd", "$ kubectl get pdb payments-api -n prod -o yaml"], ["out", "disruptionsAllowed: 0; currentHealthy: 3; desiredHealthy: 3"], ["out", "$ kubectl get deploy payments-api -n prod: 3 desired, 3 available"], ["note", "The budget is behaving correctly; there is no spare healthy replica for a voluntary eviction."]]
          },
          {
            label: "kubectl describe node and ask the application owner to watch errors",
            pts: 4, min: 8, customers: 0, fixesCause: false,
            say: [["cmd", "$ kubectl describe node ip-10-42-3-8"], ["out", "node has old kernel; no scheduling or readiness error explains the PDB refusal"], ["said", "Application owner: error rate is normal, but only three replicas exist."], ["note", "Node evidence helps, but the replica count is the actionable constraint."]]
          },
          {
            label: "kubectl drain ip-10-42-3-8 --force --ignore-daemonsets",
            pts: -10, min: 4, customers: 15000, fixesCause: false,
            say: [["cmd", "$ kubectl drain ip-10-42-3-8 --force --ignore-daemonsets"], ["bad", "error: cannot delete Pods with local storage; --force does not override the PDB safely"], ["bad", "Engineer deletes the remaining pod manually; payments returns 503 for 4 minutes"], ["note", "Force is not a PDB strategy; bypassing availability protection creates the outage you are avoiding."]]
          }
        ]
      },
      {
        prompt: "How do you create safe room for the patch?",
        choices: [
          {
            label: "Scale payments to 4, wait ready, then drain one node at a time",
            pts: 10, min: 16, customers: 0, fixesCause: true,
            say: [["cmd", "$ kubectl scale deploy/payments-api -n prod --replicas=4"], ["out", "deployment.apps/payments-api scaled; 4/4 available; disruptionsAllowed: 1"], ["cmd", "$ kubectl drain ip-10-42-3-8 --ignore-daemonsets --grace-period=60"], ["good", "pod evicted; node drained; patched node rejoins Ready with kernel 5.10.221"], ["note", "Add verified redundancy before voluntary disruption, then keep the drain serial and observable."]]
          },
          {
            label: "Temporarily set minAvailable to 2 and drain all old nodes",
            pts: 3, min: 10, customers: 3000, fixesCause: false,
            say: [["cmd", "$ kubectl patch pdb payments-api -n prod --type=merge -p '{\"spec\":{\"minAvailable\":2}}'"], ["out", "disruptionsAllowed: 1; three drain requests race"], ["warn", "Two replicas survive on paper, but one failure now removes half of payment capacity."], ["note", "Relaxing a guardrail can unblock work, but it increases correlated failure risk and is not the durable fix."]]
          },
          {
            label: "Delete the PDB, drain every old node, then recreate it",
            pts: -8, min: 7, customers: 18000, fixesCause: false,
            say: [["cmd", "$ kubectl delete pdb payments-api -n prod"], ["bad", "poddisruptionbudget.policy payments-api deleted"], ["bad", "Three evictions begin; one replica serves traffic while the rollout is unprotected"], ["note", "Deleting the budget removes the signal instead of creating capacity; concurrent drains magnify risk."]]
          }
        ]
      }
    ]
  },
  {
    id: "k8s-autoscaler-pending-capacity",
    title: "PENDING PODS, NO AUTOSCALE — EKS",
    sev: "SEV3",
    tags: ["k8s", "aws", "cost", "oncall"],
    weigh: 2,
    open: [
      ["said", "PagerDuty: [SEV3] report workers pending for 19 minutes; queue age is 11 minutes."],
      ["out", "kubectl describe pod report-worker-5d9f: 0/12 nodes fit; Insufficient cpu."],
      ["out", "cluster-autoscaler logs: pod didn't trigger scale-up; max node group size reached."],
      ["said", "Finance asks why the overnight on-demand group is already at its cap." ]
    ],
    hint: "Read the scheduler reason and autoscaler limits together. Increase only the matching nodegroup ceiling after checking quota and workload requests.",
    steps: [
      {
        prompt: "What is preventing these pods from scheduling?",
        choices: [
          {
            label: "kubectl describe pending pod and inspect autoscaler maxSize",
            pts: 10, min: 3, customers: 0, fixesCause: false,
            say: [["cmd", "$ kubectl describe pod report-worker-5d9f -n batch"], ["out", "0/12 nodes fit: 12 Insufficient cpu; preemption is not helpful"], ["cmd", "$ eksctl get nodegroup --cluster prod: report-on-demand minSize=3 maxSize=12"], ["out", "cluster-autoscaler: max node group size reached"], ["note", "The scheduler needs CPU and the autoscaler is capped; both facts must guide the change."]]
          },
          {
            label: "kubectl get nodes and delete completed pods across all namespaces",
            pts: 2, min: 6, customers: 0, fixesCause: false,
            say: [["cmd", "$ kubectl get pods -A --field-selector=status.phase=Succeeded"], ["out", "completed pods use negligible allocatable CPU; pending workers remain"], ["warn", "Deleting history adds churn without changing node capacity or requests."], ["note", "Clean up noise separately; completed pods do not explain an Insufficient cpu fit failure."]]
          },
          {
            label: "kubectl scale deployment report-worker --replicas=0 to clear pending pods",
            pts: -7, min: 3, customers: 9000, fixesCause: false,
            say: [["cmd", "$ kubectl scale deploy/report-worker -n batch --replicas=0"], ["bad", "deployment.apps/report-worker scaled; queue consumers: 0"], ["bad", "Report queue age rises from 11 to 47 minutes; alert is gone because work stopped"], ["note", "Removing demand is not restoring capacity; it converts a scheduling incident into silent backlog."]]
          }
        ]
      },
      {
        prompt: "What targeted change restores throughput?",
        choices: [
          {
            label: "Raise report-on-demand maxSize after checking EC2 quota, then watch scale-up",
            pts: 10, min: 14, customers: 0, fixesCause: true,
            say: [["cmd", "$ aws service-quotas get-service-quota --service-code ec2 --quota-code L-1216C47A"], ["out", "Running On-Demand Standard instances: 64 used of 128"], ["cmd", "$ aws autoscaling update-auto-scaling-group --auto-scaling-group-name ... --max-size 24"], ["good", "cluster-autoscaler: pod triggered scale-up; 2 nodes added; pending workers become Running"], ["note", "Change the ceiling on the matching group only, after quota validation and an observable scale-up."]]
          },
          {
            label: "Add a large instance type to every nodegroup immediately",
            pts: 3, min: 20, customers: 0, fixesCause: false,
            say: [["cmd", "$ eksctl scale nodegroup --cluster prod --name general --nodes-max 40"], ["out", "general group expands, but report pods require its taint-excluded labels"], ["warn", "Capacity is purchased in the wrong scheduling pool; cost rises while pods stay Pending."], ["note", "Match capacity to selectors, taints, and requests; more nodes elsewhere may not be usable."]]
          },
          {
            label: "Scale the report deployment to 20 replicas to force autoscaling",
            pts: -9, min: 4, customers: 12000, fixesCause: false,
            say: [["cmd", "$ kubectl scale deploy/report-worker -n batch --replicas=20"], ["bad", "pending report-worker pods: 4 -> 20; queue API request rate doubles"], ["bad", "Database connection pool saturates at 100%; successful reports fall to 0"], ["note", "Scaling into a capped cluster and shared dependency increases pressure; fix the capacity limit first."]]
          }
        ]
      }
    ]
  }
];
