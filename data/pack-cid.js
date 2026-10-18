export const pack = [
  {
    id: "cid-checkout-feature-flag-path",
    title: "CHECKOUT 5XX — FEATURE PATH",
    sev: "SEV1",
    tags: ["deploy", "k8s", "observability", "comms"],
    weigh: 3,
    open: [
      ["said", "PagerDuty: [SEV1] checkout-api 5xx is 7.8%, baseline 0.04%."],
      ["out", "Deploy checkout-api v4.18.0 completed 11 minutes ago."],
      ["said", "Support reports failures only when customers apply a promo code."],
      ["out", "EU traffic is 62% of current errors; health checks remain green."]
    ],
    hint: "Compare the failing request path and its configuration to the last known-good release before changing capacity.",
    steps: [
      {
        prompt: "What do you inspect before changing capacity?",
        choices: [
          {
            label: "Compare promo-code traces with the v4.17.3 release",
            pts: 10, min: 3, customers: 0, fixesCause: false,
            say: [["cmd", "$ kubectl logs deploy/checkout-api -n prod --since=15m | grep promo"], ["out", "promo path: invalid discount_type=percentile; 4,812 matching requests"], ["good", "Trace diff isolates the new validation branch without widening blast radius."], ["note", "Follow the failing path and artifact; a green readiness probe does not cover it."]]
          },
          {
            label: "Scale checkout-api from 24 to 48 replicas",
            pts: -8, min: 4, customers: 18000, fixesCause: false,
            say: [["cmd", "$ kubectl scale deploy/checkout-api -n prod --replicas=48"], ["out", "deployment.apps/checkout-api scaled"], ["bad", "5xx remains 7.6%; Aurora connections rise from 410 to 796."], ["note", "More pods cannot repair a deterministic feature-path error and consume the shared DB pool."]]
          },
          {
            label: "Mute the checkout 5xx monitor for one hour",
            pts: 1, min: 2, customers: 0, fixesCause: false,
            say: [["cmd", "$ datadog monitor mute 18420 --duration 3600"], ["out", "Monitor 18420 muted until 03:14 UTC"], ["warn", "Pager noise stops, but 7.8% of promo checkouts still fail."], ["note", "Silencing an instrument changes no request and hides regression evidence."]]
          }
        ]
      },
      {
        prompt: "How do you stop the bad path safely?",
        choices: [
          {
            label: "Disable promo_v2 for EU, then roll back v4.18.0",
            pts: 9, min: 7, customers: 42000, fixesCause: true,
            say: [["cmd", "$ curl -X PATCH flags/promo_v2 -d '{\"eu\":false}'"], ["out", "flag promo_v2: EU=false; canary error rate 0.08%"], ["cmd", "$ kubectl rollout undo deploy/checkout-api -n prod"], ["good", "5xx falls 7.8% -> 0.06% in 94 seconds."], ["note", "The flag limits blast radius while rollback removes the incompatible validation code."]]
          },
          {
            label: "Roll back the deployment without changing the feature flag",
            pts: 5, min: 6, customers: 42000, fixesCause: false,
            say: [["cmd", "$ kubectl rollout undo deploy/checkout-api -n prod"], ["out", "deployment.apps/checkout-api rolled back"], ["warn", "Errors fall to 0.2%, but the next flag refresh can re-enable the incompatible path."], ["note", "Rollback mitigates this release; configuration remains an unbounded trigger."]]
          },
          {
            label: "Edit the live ConfigMap to remove promo validation",
            pts: -7, min: 5, customers: 42000, fixesCause: false,
            say: [["cmd", "$ kubectl edit configmap checkout-api -n prod"], ["out", "configmap/checkout-api edited"], ["bad", "ArgoCD restores the value after 38 seconds; 3,100 requests fail again."], ["note", "Manual edits fight reconciliation and leave the source of truth unchanged."]]
          }
        ]
      }
    ]
  },
  {
    id: "cid-terraform-lock-drift",
    title: "TERRAFORM APPLY — STATE LOCKED",
    sev: "SEV2",
    tags: ["iac", "aws", "network", "oncall"],
    weigh: 2,
    open: [
      ["said", "PagerDuty: [SEV2] deploy pipeline cannot update production network."],
      ["out", "Terraform plan wants to replace an AWS route table association."],
      ["said", "Release freeze begins in 29 minutes; an earlier apply timed out."],
      ["out", "CloudTrail shows no completed apply after the timeout."]
    ],
    hint: "Treat the lock as evidence of an active or interrupted writer. Inspect the lock owner and refresh reality before unlocking.",
    steps: [
      {
        prompt: "What do you verify before touching the lock?",
        choices: [
          {
            label: "Inspect lock metadata and the failed runner state",
            pts: 10, min: 4, customers: 0, fixesCause: false,
            say: [["cmd", "$ terraform force-unlock -help; aws dynamodb get-item --table-name tf-locks"], ["out", "LockID prod/network, Who=gha-7421, Created=02:41:19Z"], ["out", "GitHub Actions run 7421 is completed: failure after SIGTERM"], ["note", "Confirm the writer is dead and identify the exact state before any unlock."]]
          },
          {
            label: "Force-unlock prod/network and apply immediately",
            pts: -9, min: 3, customers: 16000, fixesCause: false,
            say: [["cmd", "$ terraform force-unlock -force prod/network"], ["out", "Force-unlock successful"], ["bad", "A second runner writes while the timed-out apply still holds an AWS change; state now reports a stale association."], ["note", "Force-unlock blind can create concurrent writers and compound state drift."]]
          },
          {
            label: "Edit the .tfstate JSON to remove the lock field",
            pts: -5, min: 6, customers: 16000, fixesCause: false,
            say: [["cmd", "$ vi terraform.tfstate; git push --force"], ["out", "Terraform still reports Error acquiring the state lock"], ["bad", "The backend state is unchanged; the force-push removes the audit trail."], ["note", "Remote state is not repaired by hand-editing a local copy."]]
          }
        ]
      },
      {
        prompt: "How do you reconcile the drift safely?",
        choices: [
          {
            label: "Unlock after confirmation, refresh-only plan, then review apply",
            pts: 9, min: 12, customers: 0, fixesCause: true,
            say: [["cmd", "$ terraform force-unlock prod/network"], ["out", "Do you really want to force-unlock? yes; Unlock successful"], ["cmd", "$ terraform plan -refresh-only -out=refresh.tfplan"], ["out", "Plan: 1 to update state, 0 to add, 0 to change, 0 to destroy"], ["good", "Reviewed state matches AWS before the network change is reapplied."], ["note", "Refresh reality first; a reviewed plan is the change-management boundary."]]
          },
          {
            label: "Run terraform plan without refreshing remote objects",
            pts: 3, min: 5, customers: 0, fixesCause: false,
            say: [["cmd", "$ terraform plan -refresh=false"], ["out", "Plan: 0 to add, 1 to change, 0 to destroy"], ["warn", "The plan trusts stale state and cannot expose the timed-out association."], ["note", "A fast plan is incomplete when state and infrastructure may disagree."]]
          },
          {
            label: "Apply with -auto-approve to beat the release freeze",
            pts: -8, min: 4, customers: 16000, fixesCause: false,
            say: [["cmd", "$ terraform apply -auto-approve"], ["out", "Error: Error acquiring the state lock"], ["bad", "The release remains blocked and the emergency run has no reviewed plan."], ["note", "Time pressure is not approval to bypass locking or change review."]]
          }
        ]
      }
    ]
  },
  {
    id: "cid-argocd-secret-rotation-drift",
    title: "ARGOCD — SECRET ROTATION DRIFT",
    sev: "SEV3",
    tags: ["k8s", "security", "deploy", "comms"],
    weigh: 2,
    open: [
      ["said", "Slack #platform: billing-worker is OutOfSync and Progressing for 18 minutes."],
      ["out", "A responder rotated the payment API secret with kubectl during an outage."],
      ["out", "ArgoCD diff: Secret data differs; 6 of 30 pods still use the old value."],
      ["said", "Payment provider reports intermittent 401 responses, not a full outage."]
    ],
    hint: "Reconcile the declarative source and restart only consumers after the secret is valid. Do not delete the namespace to clear status.",
    steps: [
      {
        prompt: "What do you compare before restarting pods?",
        choices: [
          {
            label: "Diff Git, ArgoCD, and the live Secret metadata",
            pts: 10, min: 4, customers: 0, fixesCause: false,
            say: [["cmd", "$ argocd app diff billing-prod --refresh"], ["out", "Secret/payment-api: live data differs from Git; sync status OutOfSync"], ["cmd", "$ kubectl get secret payment-api -n billing -o jsonpath='{.metadata.annotations}'"], ["note", "Three-way comparison identifies which source changed and avoids restarting blindly."]]
          },
          {
            label: "Restart all billing-worker pods to clear stale credentials",
            pts: 2, min: 5, customers: 9000, fixesCause: false,
            say: [["cmd", "$ kubectl rollout restart deploy/billing-worker -n billing"], ["out", "deployment.apps/billing-worker restarted"], ["bad", "401 rate reaches 31% because the live Secret still has the unverified value."], ["note", "Restarting spreads bad configuration faster; verify the credential before rollout."]]
          },
          {
            label: "Delete the stuck billing namespace and let Argo recreate it",
            pts: -10, min: 8, customers: 24000, fixesCause: false,
            say: [["cmd", "$ kubectl delete namespace billing --wait=false"], ["out", "namespace/billing deleted"], ["bad", "Workers, queues, and service endpoints disappear; recovery exceeds the incident budget."], ["note", "Deleting a namespace is not reconciliation and magnifies a secret drift incident."]]
          }
        ]
      },
      {
        prompt: "How do you complete the rotation with bounded impact?",
        choices: [
          {
            label: "Commit the verified secret reference, sync Argo, roll workers",
            pts: 9, min: 10, customers: 9000, fixesCause: true,
            say: [["cmd", "$ git commit -m 'Rotate payment API credential'; argocd app sync billing-prod"], ["out", "Sync status: Synced; health: Healthy; Secret updated"], ["cmd", "$ kubectl rollout status deploy/billing-worker -n billing"], ["good", "30 pods use the new credential; provider 401s fall 31% -> 0.2%."], ["note", "The source of truth, reconciler, and consumer rollout now agree."]]
          },
          {
            label: "Revert the live Secret to its old value and monitor",
            pts: 4, min: 6, customers: 9000, fixesCause: false,
            say: [["cmd", "$ kubectl apply -f old-payment-secret.yaml -n billing"], ["out", "secret/payment-api configured"], ["warn", "401s fall to 0.2%, but the expired credential will fail at provider cutoff."], ["note", "This mitigates symptoms but postpones the required rotation."]]
          },
          {
            label: "Set ArgoCD sync policy to ignore Secret differences",
            pts: -8, min: 5, customers: 9000, fixesCause: false,
            say: [["cmd", "$ argocd app set billing-prod --ignore-differences Secret"], ["out", "Application configured to ignore Secret differences"], ["bad", "Argo reports Synced while six pods continue using the old credential."], ["note", "Ignoring drift removes the alarm, not the inconsistent secret state."]]
          }
        ]
      }
    ]
  }
];
