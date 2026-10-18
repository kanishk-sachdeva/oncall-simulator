# ON-CALL — incident content spec (v2)

You are writing **content packs** for a live, public browser game called **ON-CALL**.
It is a text-based platform-engineering incident simulator. The player is the on-call engineer
for one night shift. Every incident is a short decision tree. Wrong-but-tempting choices must be
genuinely tempting, and every outcome must teach something real.

This file is the **frozen contract**. Do not invent new fields, do not rename fields, do not
change line classes. The integrator merges your file mechanically.

## Deliverable

One ES module per pack at the path given in your task, exporting:

```js
export const pack = [ /* incident objects */ ];
```

No imports, no side effects, no `console.log`, no top-level code besides the export.
Pure data. Valid JavaScript. Must pass `node --check`.

## Incident object

```js
{
  id: "kebab-case-unique-id",          // string, unique across ALL packs, descriptive
  title: "CHECKOUT 5XX — EU-WEST-1",   // UPPERCASE, what the pager says, <= 42 chars
  sev: "SEV1",                          // "SEV1" | "SEV2" | "SEV3" only
  tags: ["k8s", "deploy"],              // 2-4 from: k8s, aws, deploy, database, network,
                                        //   tls, cost, queue, observability, comms, iac, security, oncall
  weigh: 2,                             // 1 = rare, 2 = normal, 3 = this is the good one. Use 3 at most once.
  open: [                               // 3-5 lines that set the scene before the first prompt
    ["said", "PagerDuty: [SEV1] checkout-api error rate 8.2% (baseline 0.05%). 6 min."],
    ["out",  "Last deploy: checkout-api v2.14.1, 12 minutes ago."]
  ],
  hint: "One or two sentences of runbook advice if the player pays to consult it.",
  steps: [ /* 2-3 step objects */ ]
}
```

## Step object

```js
{
  prompt: "What do you check first?",   // one question, <= 60 chars
  choices: [ /* 3-4 choice objects */ ]
}
```

Always give 3 or 4 choices. Exactly ONE choice is the best play (`pts` 9-10) and exactly ONE is a
blunder (`pts` <= -6). The remaining 1-2 are plausible-but-incomplete (+1 to +6).

## Choice object

```js
{
  label:  "kubectl rollout undo deploy/checkout-api -n prod",  // <= 78 chars, imperative,
                                                               // reads like the thing you'd actually type or say
  pts:    9,             // integer -15..10. The ONLY scoring input.
  min:    2,             // integer 2..40: minutes this costs on the incident clock
  customers: 40000,      // integer >= 0: customers affected by THIS decision. 0 for pure diagnosis.
  fixesCause: true,      // boolean: does this make the root cause impossible, not just invisible?
  say: [                 // 2-6 lines: what the command prints and what it means
    ["cmd",  "$ kubectl rollout undo deploy/checkout-api -n prod"],
    ["out",  "deployment.apps/checkout-api rolled back"],
    ["good", "Error rate 8.2% -> 0.1% in 90 seconds."],
    ["note", "Right instinct, incomplete job: the bad image is still in the registry."]
  ]
}
```

### Line classes (use exactly these strings, they map to CSS classes)

| class   | use for |
|---------|---------|
| `cmd`   | a command that was run, or the choice echoed back |
| `out`   | neutral system output |
| `good`  | something improved, correct reasoning rewarded |
| `bad`   | damage, degradation, an outage you caused |
| `warn`  | it worked, but with a hidden cost |
| `note`  | the teaching line: why this was right or wrong. Use at most ONE `note` per choice |
| `said`  | a human speaking (pager, Slack, a customer, your lead) |
| `head`  | a section break, always uppercase with  no closing punctuation |

## The rules that make this game good

1. **Real commands, real output.** Quote actual CLI/SQL/kubectl/aws output shapes. No invented tooling.
2. **The tempting choice is the villain.** Blunders must be things a tired engineer genuinely does:
   restart everything, scale into a bottleneck, silence the alert, raise the limit, roll back blind,
   `--force`, delete the Node object, `--all`, disable retries cluster-wide, buy more capacity.
3. **`fixesCause` is the spine of the game.** A choice that mitigates the symptom scores well but sets
   `fixesCause: false`; the incident then RECURS later in the shift, worse. Only root-cause moves set it true.
4. **Specific numbers beat adjectives.** "p99 4.8s -> 620ms", "118 sessions idle in transaction for 41 minutes",
   "41 TB through a NAT gateway at $0.045/GB". Never "much faster" or "quite expensive".
5. **No emoji, no exclamation marks, no marketing voice.** Terse, dry, competent. The tone is a
   postmortem document, not a blog post.
6. **Teach one transferable lesson per step.** Examples worth encoding: blast radius is chosen before you
   type; never scale into a shared dependency; monitor the artifact you serve, not the object you configured;
   alert before the cliff; rejection beats an unbounded queue; a manual fix that evaporates with the node
   is not a fix; never silence the instrument to fix the reading; retries need jitter and a breaker;
   the deploy that broke it is usually the deploy that touched it, but "last thing anyone touched" is not
   a hypothesis; cost is found in the line item, not the resource list.
7. **Canadian / enterprise realism is welcome** — PagerDuty, Slack, Datadog, ArgoCD, EKS, Terraform,
   OpenSearch, Kafka, Aurora, Route53. No vendor advertising, no fictional products.
8. **Length discipline.** Whole incident: 2-3 steps, each with 3-4 choices, each choice 2-6 `say` lines.
   Keep every line under 160 characters so it reads well on a phone.

## Difficulty gradient

Your pack should include one SEV1, one SEV2 and one SEV3, in any order, covering different `tags`.
Vary the failure domain: not three k8s problems in a row.

## Self-check before you finish

- `node --check <your file>` passes.
- `id` values are unique and descriptive.
- Every step: exactly one 9-10 pt choice, exactly one <= -6 pt choice, 3-4 choices total.
- Every choice has `pts`, `min`, `customers`, `fixesCause`, `say` (2-6 lines) and `label`.
- No choice scores above 10 or below -15.
- You can print the file's byte count and the number of incidents on stdout in your final summary.
