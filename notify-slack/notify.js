// Sestaví zprávu o běhu workflow a pošle ji do Slacku přes incoming webhook.
// Spouští ji action.yml přes actions/github-script, odtud `github` (Octokit),
// `context` a `core`. Vstupy přicházejí v proměnných NOTIFY_*.

module.exports = async function notifySlack({ github, context, core }) {
  const webhook = process.env.NOTIFY_WEBHOOK;
  if (!webhook) {
    core.warning('Chybí webhook do Slacku, notifikace se neposílá.');
    return;
  }

  try {
    const run = await describeRun(github, context);
    const text = process.env.NOTIFY_EVENT === 'start'
      ? composeStartMessage(run)
      : await composeResultMessage(github, context, run);
    await postToSlack(webhook, text);
  } catch (error) {
    core.warning(`Notifikace do Slacku se nepovedla: ${error.message}`);
  }
};

async function describeRun(github, context) {
  const { owner, repo } = context.repo;
  const repoUrl = `${context.serverUrl}/${owner}/${repo}`;
  return {
    title: process.env.NOTIFY_TITLE || repo,
    shortSha: context.sha.slice(0, 7),
    commitTitle: await readCommitTitle(github, context),
    commitUrl: `${repoUrl}/commit/${context.sha}`,
    runUrl: `${repoUrl}/actions/runs/${context.runId}`,
    actor: context.actor,
    trigger: describeTrigger(context),
  };
}

// Push nese zprávu commitu v payloadu, ruční spuštění ani tag ne — pak se
// commit dočte přes API.
async function readCommitTitle(github, context) {
  let message = context.payload.head_commit?.message;
  if (!message) {
    const { data } = await github.rest.repos.getCommit({ ...context.repo, ref: context.sha });
    message = data.commit.message;
  }
  return message.split('\n')[0];
}

function describeTrigger(context) {
  const ref = context.ref.replace(/^refs\/(heads|tags)\//, '');
  if (context.eventName === 'workflow_dispatch') return `ruční spuštění na ${ref}`;
  if (context.ref.startsWith('refs/tags/')) return `tag ${ref}`;
  return `push do ${ref}`;
}

function composeStartMessage(run) {
  return [
    `🚀 *${run.title}* – začíná běh ${formatCommit(run)}`,
    formatOrigin(run),
    `<${run.runUrl}|Otevřít běh>`,
  ].join('\n');
}

async function composeResultMessage(github, context, run) {
  const needs = JSON.parse(process.env.NOTIFY_NEEDS || '{}');
  const failedJobIds = Object.keys(needs).filter((id) => needs[id].result === 'failure');
  const isCancelled = Object.values(needs).some((job) => job.result === 'cancelled');

  if (failedJobIds.length > 0) {
    const failedJobs = await findFailedJobs(github, context);
    return composeFailureMessage(run, failedJobs, failedJobIds);
  }
  if (isCancelled) return composeCancelMessage(run);
  return composeSuccessMessage(run);
}

// Jména jobů v API jsou jejich zobrazovaná jména (`name:`), ne klíče z `needs`,
// takže se nepárují — prostě se vezmou všechny joby, které v tomhle pokusu
// selhaly. Bez práva `actions: read` API odpoví chybou; zpráva pak odejde
// aspoň s klíči jobů ze `needs`.
async function findFailedJobs(github, context) {
  try {
    const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt, {
      ...context.repo,
      run_id: context.runId,
      attempt_number: Number(process.env.GITHUB_RUN_ATTEMPT || 1),
      per_page: 100,
    });
    return jobs
      .filter((job) => job.conclusion === 'failure')
      .map((job) => ({
        name: job.name,
        step: job.steps?.find((step) => step.conclusion === 'failure')?.name,
        url: job.html_url,
      }));
  } catch (error) {
    console.log(`Joby běhu se nepodařilo načíst: ${error.message}`);
    return [];
  }
}

function composeFailureMessage(run, failedJobs, failedJobIds) {
  const details = failedJobs.length > 0
    ? failedJobs.map(formatFailedJob)
    : [`• Selhalo: *${failedJobIds.join(', ')}*`];
  return [
    `❌ *${run.title}* – selhal běh ${formatCommit(run)}`,
    ...details,
    process.env.NOTIFY_FAILURE_TEXT,
    formatOrigin(run),
    `<${run.runUrl}|Otevřít běh> · <${run.commitUrl}|Commit>`,
  ].filter(Boolean).join('\n');
}

function formatFailedJob(job) {
  const step = job.step ? `, krok *${escapeSlack(job.step)}*` : '';
  return `• Job *${escapeSlack(job.name)}*${step} – <${job.url}|otevřít log>`;
}

function composeCancelMessage(run) {
  return [
    `⚪ *${run.title}* – běh ${formatCommit(run)} byl zrušen`,
    formatOrigin(run),
    `<${run.runUrl}|Otevřít běh>`,
  ].join('\n');
}

function composeSuccessMessage(run) {
  return [
    `✅ *${run.title}* – ${formatCommit(run)}`,
    process.env.NOTIFY_SUCCESS_TEXT || 'Běh prošel.',
    formatOrigin(run),
    `<${run.runUrl}|Otevřít běh>`,
  ].join('\n');
}

function formatCommit(run) {
  return `<${run.commitUrl}|\`${run.shortSha}\`> „${escapeSlack(run.commitTitle)}“`;
}

function formatOrigin(run) {
  return `Spustil: ${run.actor} · ${run.trigger}`;
}

// Slack v textu zprávy bere &, < a > jako řídicí znaky (odkazy, zmínky).
function escapeSlack(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function postToSlack(webhook, text) {
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, unfurl_links: false }),
  });
  if (!response.ok) {
    throw new Error(`Slack odpověděl ${response.status}: ${await response.text()}`);
  }
}
