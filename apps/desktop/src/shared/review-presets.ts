import {
  type ReviewConfiguration,
  reviewConfigurationSchema,
  reviewerProfileSchema,
  reviewWorkflowSchema,
} from './contracts.js'

export const builtInReviewerIds = {
  architecture: '00000000-0000-4000-8000-000000000101',
  correctness: '00000000-0000-4000-8000-000000000103',
  security: '00000000-0000-4000-8000-000000000102',
  test: '00000000-0000-4000-8000-000000000104',
} as const

export const comprehensiveReviewWorkflowId = '00000000-0000-4000-8000-000000000201'

export const builtInReviewerProfiles = reviewerProfileSchema.array().parse([
  {
    description: 'Reviews design boundaries, dependencies, data flow, and maintainability.',
    id: builtInReviewerIds.architecture,
    instructions: [
      'Review only the supplied repository changes and report concrete architecture regressions.',
      'Focus on responsibility boundaries, dependency direction, coupling, data flow, concurrency, and long-term maintainability.',
      'Do not request broad redesigns unless the changed code creates a specific correctness, operability, or evolution risk.',
    ].join(' '),
    model: null,
    name: 'Architecture Reviewer',
    origin: 'built-in',
    reasoningEffort: null,
  },
  {
    description: 'Finds security and privacy regressions in changed code.',
    id: builtInReviewerIds.security,
    instructions: [
      'Review only the supplied repository changes and report concrete security or privacy regressions.',
      'Focus on authentication, authorization, input validation, secrets, injection, sensitive data, and unsafe filesystem, process, or network access.',
      'Explain the reachable impact and avoid speculative findings without a plausible execution path.',
    ].join(' '),
    model: null,
    name: 'Security Reviewer',
    origin: 'built-in',
    reasoningEffort: null,
  },
  {
    description: 'Checks logic, state transitions, edge cases, and contract compatibility.',
    id: builtInReviewerIds.correctness,
    instructions: [
      'Review only the supplied repository changes and report concrete behavioral regressions.',
      'Focus on logic, state transitions, error handling, boundary conditions, race conditions, data integrity, and compatibility with existing contracts.',
      'Prefer reproducible failure scenarios over stylistic recommendations.',
    ].join(' '),
    model: null,
    name: 'Correctness Reviewer',
    origin: 'built-in',
    reasoningEffort: null,
  },
  {
    description: 'Checks whether changed behavior is validated with the right scenarios.',
    id: builtInReviewerIds.test,
    instructions: [
      'Review only the supplied repository changes and report material validation gaps that could hide a regression.',
      'Focus on missing boundary, failure, integration, and regression scenarios as well as weak or flaky assertions.',
      'Respect the repository instructions and its established validation strategy; do not demand automated tests where they are explicitly out of scope.',
    ].join(' '),
    model: null,
    name: 'Test Reviewer',
    origin: 'built-in',
    reasoningEffort: null,
  },
])

export const comprehensiveReviewWorkflow = reviewWorkflowSchema.parse({
  id: comprehensiveReviewWorkflowId,
  name: 'Comprehensive Review',
  origin: 'built-in',
  reviewers: builtInReviewerProfiles.map((profile) => ({
    defaultEnabled: true,
    profileId: profile.id,
    required: false,
  })),
})

const builtInProfileIdSet = new Set(builtInReviewerProfiles.map((profile) => profile.id))

export function isBuiltInReviewerId(profileId: string): boolean {
  return builtInProfileIdSet.has(profileId)
}

export function isBuiltInWorkflowId(workflowId: string): boolean {
  return workflowId === comprehensiveReviewWorkflowId
}

export function withBuiltInReviewConfiguration(
  configuration: ReviewConfiguration,
): ReviewConfiguration {
  return reviewConfigurationSchema.parse({
    profiles: [
      ...builtInReviewerProfiles,
      ...configuration.profiles
        .filter((profile) => !isBuiltInReviewerId(profile.id))
        .map((profile) => ({ ...profile, origin: 'custom' as const })),
    ],
    workflows: [
      comprehensiveReviewWorkflow,
      ...configuration.workflows
        .filter((workflow) => !isBuiltInWorkflowId(workflow.id))
        .map((workflow) => ({ ...workflow, origin: 'custom' as const })),
    ],
  })
}
