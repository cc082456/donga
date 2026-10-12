const fs = require('node:fs/promises');
const path = require('node:path');

const WINDOW_DAYS = 30;
const HOUR_IN_MS = 60 * 60 * 1000;

async function listRecentDeployments(github, owner, repo, since) {
  const deployments = [];

  for (let page = 1; ; page += 1) {
    const { data } = await github.rest.repos.listDeployments({
      owner,
      repo,
      per_page: 100,
      page,
    });

    if (data.length === 0) {
      break;
    }

    const recent = data.filter(
      (deployment) => new Date(deployment.created_at) >= since,
    );
    deployments.push(...recent);

    if (recent.length !== data.length) {
      break;
    }
  }

  return deployments;
}

async function getDeploymentOutcome(github, owner, repo, deployment) {
  const { data: statuses } =
    await github.rest.repos.listDeploymentStatuses({
      owner,
      repo,
      deployment_id: deployment.id,
      per_page: 100,
    });

  const terminalStatus = statuses
    .filter((status) =>
      ['success', 'failure', 'error'].includes(status.state),
    )
    .sort(
      (left, right) =>
        new Date(right.created_at) - new Date(left.created_at),
    )[0];

  if (!terminalStatus) {
    return null;
  }

  return {
    deployment,
    environment: deployment.environment,
    state: terminalStatus.state,
    finishedAt: new Date(terminalStatus.created_at),
  };
}

async function getLeadTimes(github, owner, repo, outcomes) {
  const successfulDeployments = outcomes
    .filter((outcome) => outcome.state === 'success')
    .sort((left, right) => left.finishedAt - right.finishedAt);
  const firstDeploymentByPullRequest = new Map();
  const pullRequestsBySha = new Map();

  for (const outcome of successfulDeployments) {
    const sha = outcome.deployment.sha;
    if (!pullRequestsBySha.has(sha)) {
      const pulls = await github.paginate(
        github.rest.repos.listPullRequestsAssociatedWithCommit,
        {
          owner,
          repo,
          commit_sha: sha,
          per_page: 100,
        },
      );
      pullRequestsBySha.set(sha, pulls);
    }

    for (const pullRequest of pullRequestsBySha.get(sha)) {
      if (
        pullRequest.merged_at &&
        new Date(pullRequest.merged_at) <= outcome.finishedAt &&
        !firstDeploymentByPullRequest.has(pullRequest.number)
      ) {
        firstDeploymentByPullRequest.set(
          pullRequest.number,
          outcome.finishedAt - new Date(pullRequest.merged_at),
        );
      }
    }
  }

  return [...firstDeploymentByPullRequest.values()];
}

function calculateMean(values) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatHours(milliseconds) {
  return `${(milliseconds / HOUR_IN_MS).toFixed(1)} hours`;
}

function calculateRecoveryTimes(outcomes) {
  const ordered = [...outcomes].sort(
    (left, right) => left.finishedAt - right.finishedAt,
  );
  const recoveries = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const failedDeployment = ordered[index];
    if (!['failure', 'error'].includes(failedDeployment.state)) {
      continue;
    }

    const recovery = ordered
      .slice(index + 1)
      .find(
        (outcome) =>
          outcome.environment === failedDeployment.environment &&
          outcome.state === 'success',
      );

    if (recovery) {
      recoveries.push(recovery.finishedAt - failedDeployment.finishedAt);
    }
  }

  return recoveries;
}

async function run({
  github,
  context,
  core,
  windowDays = 30,
  outputFile = 'dora-metrics.json',
}) {
  const { owner, repo } = context.repo;
  const generatedAt = new Date();
  const since = new Date(
    generatedAt.getTime() - windowDays * 24 * HOUR_IN_MS,
  );
  const deployments = await listRecentDeployments(
    github,
    owner,
    repo,
    since,
  );
  const outcomes = (
    await Promise.all(
      deployments.map((deployment) =>
        getDeploymentOutcome(github, owner, repo, deployment),
      ),
    )
  ).filter(Boolean);

  const successfulDeployments = outcomes.filter(
    (outcome) => outcome.state === 'success',
  );
  const failedDeployments = outcomes.filter((outcome) =>
    ['failure', 'error'].includes(outcome.state),
  );
  const completedDeployments =
    successfulDeployments.length + failedDeployments.length;
  const leadTimes = await getLeadTimes(github, owner, repo, outcomes);
  const recoveryTimes = calculateRecoveryTimes(outcomes);
  const averageLeadTime = calculateMean(leadTimes);
  const averageRecoveryTime = calculateMean(recoveryTimes);
  const failureRate =
    completedDeployments === 0
      ? null
      : (failedDeployments.length / completedDeployments) * 100;
  const metrics = {
    generated_at: generatedAt.toISOString(),
    window: {
      start: since.toISOString(),
      end: generatedAt.toISOString(),
      days: windowDays,
    },
    metrics: {
      lead_time_for_changes: {
        average_hours:
          averageLeadTime === null
            ? null
            : averageLeadTime / HOUR_IN_MS,
        sample_count: leadTimes.length,
      },
      deployment_frequency: {
        successful_deployments: successfulDeployments.length,
        deployments_per_day: successfulDeployments.length / windowDays,
      },
      mean_time_to_recovery: {
        average_hours:
          averageRecoveryTime === null
            ? null
            : averageRecoveryTime / HOUR_IN_MS,
        sample_count: recoveryTimes.length,
      },
      change_failure_rate: {
        percentage: failureRate,
        failed_deployments: failedDeployments.length,
        completed_deployments: completedDeployments,
      },
    },
  };

  await fs.writeFile(
    path.join(process.cwd(), outputFile),
    `${JSON.stringify(metrics, null, 2)}\n`,
    'utf8',
  );

  const summary = [
    `## DORA metrics (last ${windowDays} days)`,
    '',
    '| Metric | Result |',
    '| --- | --- |',
    `| Lead time for changes | ${
      averageLeadTime === null ? 'N/A' : formatHours(averageLeadTime)
    } (average of ${leadTimes.length} merged PRs) |`,
    `| Deployment frequency | ${successfulDeployments.length} successful deployments (${(
      successfulDeployments.length / windowDays
    ).toFixed(2)} per day) |`,
    `| Mean time to recovery (MTTR) | ${
      averageRecoveryTime === null
        ? 'N/A'
        : `${formatHours(averageRecoveryTime)} (average of ${recoveryTimes.length} recoveries)`
    } |`,
    `| Change failure rate | ${
      failureRate === null
        ? 'N/A'
        : `${failureRate.toFixed(1)}% (${failedDeployments.length} failed of ${completedDeployments} completed deployments)`
    } |`,
    '',
    'Lead time is measured from PR merge to its first successful deployment. MTTR is measured from a failed/error deployment to the next successful deployment in the same environment; unrecovered failures are excluded.',
  ].join('\n');

  await core.summary.addRaw(summary).write();
  core.info(summary);
  return { metrics, summary };
}

module.exports = { run };
