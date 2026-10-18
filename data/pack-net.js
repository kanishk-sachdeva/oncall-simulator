export const pack = [
  {
    id: "net-dns-servfail-az1",
    title: "DNS SERVFAIL — US-EAST-1A",
    sev: "SEV1",
    tags: ["network", "aws", "observability", "oncall"],
    weigh: 3,
    open: [
      ["said", "PagerDuty: [SEV1] API lookup failures in us-east-1a, 31% of requests."],
      ["out", "Checkout latency p99: 680ms -> 9.4s. us-east-1b remains at 710ms."],
      ["said", "Support: customers report intermittent 'upstream unavailable' errors."],
      ["out", "Deploys: no application changes in the last 47 minutes."]
    ],
    hint: "Compare resolution from affected and healthy AZs before changing DNS. SERVFAIL is a resolver path symptom, not proof that a record is absent.",
    steps: [
      {
        prompt: "How do you isolate the DNS failure?",
        choices: [
          {
            label: "Run dig against the VPC resolver from pods in both AZs",
            pts: 10, min: 3, customers: 0, fixesCause: false,
            say: [
              ["cmd", "$ dig +time=2 +tries=1 api.internal.example.com @10.0.0.2"],
              ["out", ";; ->>HEADER<<- opcode: QUERY, status: SERVFAIL, id: 4812"],
              ["out", "us-east-1a: 7/10 SERVFAIL; us-east-1b: 0/10 SERVFAIL"],
              ["note", "AZ comparison bounds the fault to the resolver path without changing the blast radius."]
            ]
          },
          {
            label: "Flush DNS caches on every node and restart CoreDNS",
            pts: -8, min: 8, customers: 18000, fixesCause: false,
            say: [
              ["cmd", "$ kubectl rollout restart deployment/coredns -n kube-system"],
              ["out", "deployment.apps/coredns restarted"],
              ["bad", "SERVFAIL rises to 46% while resolver pods recycle."],
              ["note", "Wiping caches everywhere destroys useful evidence and cannot repair an upstream resolver endpoint."]
            ]
          },
          {
            label: "Check the Route 53 private hosted zone record in console",
            pts: 3, min: 5, customers: 0, fixesCause: false,
            say: [
              ["cmd", "$ aws route53 list-resource-record-sets --hosted-zone-id Z0123EXAMPLE"],
              ["out", "api.internal.example.com. A 10.42.8.19 TTL 30"],
              ["warn", "The record exists, but this does not test the failing resolver path."],
              ["note", "Record existence is weaker evidence than a query from the affected AZ."]
            ]
          }
        ]
      },
      {
        prompt: "What is the safest repair?",
        choices: [
          {
            label: "Restore the us-east-1a resolver endpoint route and verify dig",
            pts: 10, min: 7, customers: 0, fixesCause: true,
            say: [
              ["cmd", "$ aws ec2 replace-route --route-table-id rtb-0a1 --destination-cidr-block 10.0.0.2/32 --vpc-peering-connection-id pcx-91"],
              ["out", "{\"Return\":true}"],
              ["good", "dig status: NOERROR; SERVFAIL 31% -> 0.0% in us-east-1a."],
              ["note", "The route was the resolver path's root cause; verify from both AZs before closing."]
            ]
          },
          {
            label: "Point every service at public 8.8.8.8 immediately",
            pts: -7, min: 6, customers: 24000, fixesCause: false,
            say: [
              ["cmd", "$ kubectl -n prod set env deploy/api DNS_SERVER=8.8.8.8"],
              ["bad", "Private name lookups return: server can't find api.internal.example.com: NXDOMAIN"],
              ["out", "Internal calls fail closed; customer errors reach 62%."],
              ["note", "A public resolver cannot answer private hosted-zone records and creates a second outage."]
            ]
          },
          {
            label: "Increase client DNS retries from one to five",
            pts: 4, min: 4, customers: 3000, fixesCause: false,
            say: [
              ["cmd", "$ kubectl -n prod patch deploy/api --type merge -p '{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"dns.retries\":\"5\"}}}}}'"],
              ["out", "Retry rate increases 2.1x; SERVFAIL remains 31%."],
              ["warn", "Retries mask some requests while amplifying load on the broken resolver."],
              ["note", "Mitigation is not a repair when the resolver route is still missing."]
            ]
          }
        ]
      }
    ]
  },
  {
    id: "net-tls-handshake-wrong-secret",
    title: "TLS CERTIFICATE — HANDSHAKE FAIL",
    sev: "SEV2",
    tags: ["tls", "k8s", "deploy", "security"],
    weigh: 2,
    open: [
      ["said", "PagerDuty: [SEV2] public checkout TLS errors, 14% of requests."],
      ["out", "cert-manager Certificate checkout.example.com: READY=True, age 3 days."],
      ["out", "Ingress controller logs: remote error: tls: bad certificate"],
      ["said", "Lead: the error began after yesterday's ingress Service change."]
    ],
    hint: "Inspect the certificate actually served on the wire. A READY Certificate object does not prove the load balancer serves its secret.",
    steps: [
      {
        prompt: "What do you inspect before changing certificates?",
        choices: [
          {
            label: "Run openssl s_client and compare the served serial to the Secret",
            pts: 10, min: 4, customers: 0, fixesCause: false,
            say: [
              ["cmd", "$ echo | openssl s_client -connect checkout.example.com:443 -servername checkout.example.com 2>/dev/null | openssl x509 -noout -serial -dates"],
              ["out", "serial=3A91; notAfter=Jan 12 00:00:00 2027 GMT"],
              ["cmd", "$ kubectl -n edge get secret checkout-tls -o jsonpath='{.data.tls.crt}' | base64 -d | openssl x509 -noout -serial"],
              ["note", "The wire artifact is serial 3A91; the READY certificate's Secret is serial 7F02."]
            ]
          },
          {
            label: "Delete all cert-manager resources and recreate them",
            pts: -8, min: 12, customers: 16000, fixesCause: false,
            say: [
              ["cmd", "$ kubectl -n edge delete certificate,certificaterequest,secret -l app=checkout"],
              ["bad", "kubectl: secrets 'checkout-tls' deleted; ingress returns 503 Service Unavailable"],
              ["out", "New issuance waits on DNS-01 propagation; errors rise to 41%."],
              ["note", "Deleting healthy issuance state before tracing the served secret turns a certificate bug into downtime."]
            ]
          },
          {
            label: "Check only the Certificate READY condition in Kubernetes",
            pts: 2, min: 3, customers: 0, fixesCause: false,
            say: [
              ["cmd", "$ kubectl -n edge get certificate checkout -o jsonpath='{.status.conditions[0]}'"],
              ["out", "{\"type\":\"Ready\",\"status\":\"True\",\"reason\":\"Ready\"}"],
              ["warn", "READY describes cert-manager's object, not the certificate the load balancer presents."],
              ["note", "Always compare the wire certificate with the referenced Secret and listener configuration."]
            ]
          }
        ]
      },
      {
        prompt: "How do you make the serving path use the valid cert?",
        choices: [
          {
            label: "Point the listener at checkout-tls and reload ingress",
            pts: 10, min: 6, customers: 0, fixesCause: true,
            say: [
              ["cmd", "$ kubectl -n edge annotate ingress ingress-public alb.ingress.kubernetes.io/certificate-arn=arn:aws:acm:ca-central-1:123:certificate/7f02"],
              ["out", "service/ingress-public patched; target group deregistration delay unchanged"],
              ["good", "openssl serial=7F02; curl -v returns HTTP/2 200; TLS errors 14% -> 0.1%."],
              ["note", "The fix changes the artifact selected by the serving listener, not just cert-manager status."]
            ]
          },
          {
            label: "Disable TLS verification for all checkout clients",
            pts: -7, min: 5, customers: 19000, fixesCause: false,
            say: [
              ["cmd", "$ kubectl -n prod set env deploy/checkout TLS_SKIP_VERIFY=true"],
              ["bad", "curl -k -v succeeds, but browsers still report ERR_CERT_DATE_INVALID."],
              ["out", "Internal clients stop checking identity; public failures remain at 14%."],
              ["note", "Disabling verification hides trust failures and does not change the certificate served to customers."]
            ]
          },
          {
            label: "Restart every ingress replica to force a certificate reload",
            pts: 4, min: 7, customers: 4000, fixesCause: false,
            say: [
              ["cmd", "$ kubectl -n edge rollout restart deploy/ingress-controller"],
              ["out", "deployment.apps/ingress-controller restarted; serial remains 3A91"],
              ["warn", "The hand-made Service secret is still selected after restart."],
              ["note", "A restart reloads the wrong input; it cannot correct a listener reference."]
            ]
          }
        ]
      }
    ]
  },
  {
    id: "net-edge-504-healthcheck-path",
    title: "ALB 504 — TARGET HEALTH CHECK",
    sev: "SEV3",
    tags: ["network", "aws", "observability", "oncall"],
    weigh: 2,
    open: [
      ["said", "PagerDuty: [SEV3] search API 504s, 8.7% for 11 minutes."],
      ["out", "ALB access log: elb_status_code=504 target_status_code=- request_processing_time=60.001"],
      ["out", "Application logs show no request for the timed-out trace IDs."],
      ["said", "Release channel: no search deploy; Terraform changed target health checks 18 minutes ago."]
    ],
    hint: "A 504 with no target status code points at the edge-to-target path. Compare the configured health-check port and path with the listener target.",
    steps: [
      {
        prompt: "Which evidence separates ALB from application failure?",
        choices: [
          {
            label: "Use curl -v to the ALB and inspect target health and access logs",
            pts: 10, min: 4, customers: 0, fixesCause: false,
            say: [
              ["cmd", "$ curl -v --max-time 5 https://search.example.com/healthz"],
              ["out", "< HTTP/2 504\\n< x-amzn-errortype: InternalFailure"],
              ["cmd", "$ aws elbv2 describe-target-health --target-group-arn arn:aws:elasticloadbalancing:ca-central-1:123:targetgroup/search/abc"],
              ["out", "TargetHealth: unused Reason=Target.ResponseCodeMismatch; HealthCheckPath=/readyz"],
              ["note", "The edge is timing out before a target response; target health and access logs narrow the fault."]
            ]
          },
          {
            label: "Scale search from 12 to 60 replicas immediately",
            pts: -8, min: 9, customers: 14000, fixesCause: false,
            say: [
              ["cmd", "$ kubectl -n prod scale deploy/search --replicas=60"],
              ["out", "deployment.apps/search scaled; ALB still reports 504 from upstream"],
              ["bad", "Cluster autoscaler adds 48 pods and saturates the shared node subnet."],
              ["note", "More targets cannot help when the health check marks the target group unusable."]
            ]
          },
          {
            label: "Restart the load balancer to clear its connection state",
            pts: -5, min: 10, customers: 22000, fixesCause: false,
            say: [
              ["cmd", "$ aws elbv2 reboot-load-balancer --load-balancer-arn arn:aws:elasticloadbalancing:ca-central-1:123:loadbalancer/app/search/xyz"],
              ["bad", "aws: error: argument operation: Invalid choice, valid choices are ..."],
              ["out", "No AWS ALB reboot operation exists; 504 rate remains 8.7%."],
              ["note", "Treat the managed edge as configuration plus evidence, not a host you can reboot."]
            ]
          }
        ]
      },
      {
        prompt: "What targeted change restores healthy targets?",
        choices: [
          {
            label: "Set the target health check to the service's 200 /healthz endpoint",
            pts: 10, min: 7, customers: 0, fixesCause: true,
            say: [
              ["cmd", "$ aws elbv2 modify-target-group --target-group-arn \"$TG_ARN\" --health-check-path /healthz --health-check-port traffic-port"],
              ["out", "TargetHealth: healthy; ResponseCode=200; HealthCheckPath=/healthz"],
              ["good", "ALB 504s 8.7% -> 0.0%; p95 420ms. Application request logs resume."],
              ["note", "The target group now probes the route and port the service actually exposes."]
            ]
          },
          {
            label: "Allow 0.0.0.0/0 to the search security group",
            pts: -8, min: 8, customers: 21000, fixesCause: false,
            say: [
              ["cmd", "$ aws ec2 authorize-security-group-ingress --group-id sg-0search --protocol tcp --port 8080 --cidr 0.0.0.0/0"],
              ["bad", "Security group rule added; targets still show ResponseCodeMismatch."],
              ["out", "Search port 8080 is now publicly reachable; 504s remain."],
              ["note", "A health-check path mismatch is not a reachability problem, and 0.0.0.0/0 expands exposure."]
            ]
          },
          {
            label: "Raise the ALB idle timeout from 60 to 300 seconds",
            pts: 3, min: 5, customers: 3000, fixesCause: false,
            say: [
              ["cmd", "$ aws elbv2 modify-load-balancer-attributes --attributes Key=idle_timeout.timeout_seconds,Value=300"],
              ["out", "Load balancer attribute modified; target health remains unused"],
              ["warn", "Requests now wait five minutes before failing, increasing connection pressure."],
              ["note", "Timeout tuning cannot make an unhealthy target pass its configured probe."]
            ]
          }
        ]
      }
    ]
  }
];
