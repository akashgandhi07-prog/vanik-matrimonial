import { useCallback, useEffect, useState } from 'react';
import { supabase, invokeFunction } from '../../lib/supabase';

type CronJobRun = {
  id: string;
  job_name: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  result: Record<string, unknown> | null;
  triggered_by: string;
};

type JobInfo = {
  name: string;
  schedule: string;
  scheduleLabel: string;
};

const JOBS: JobInfo[] = [
  { name: 'send-feedback-reminders', schedule: '0 8 * * *', scheduleLabel: 'Daily at 08:00' },
  { name: 'send-renewal-reminders', schedule: '0 8 * * *', scheduleLabel: 'Daily at 08:00' },
  { name: 'expire-memberships', schedule: '0 7 * * *', scheduleLabel: 'Daily at 07:00' },
];

function statusColor(status: string): string {
  if (status === 'success') return 'var(--color-success)';
  if (status === 'error') return 'var(--color-danger)';
  return '#d97706'; // amber for running
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-GB');
}

function resultSummary(run: CronJobRun | undefined): string {
  if (!run) return '-';
  if (!run.result) return '-';
  return Object.entries(run.result)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(', ');
}

export default function AdminScheduledJobs() {
  const [latestRuns, setLatestRuns] = useState<Record<string, CronJobRun>>({});
  const [loading, setLoading] = useState(false);
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const jobNames = JOBS.map((j) => j.name);
      const { data, error: qErr } = await supabase
        .from('cron_job_runs')
        .select('*')
        .in('job_name', jobNames)
        .order('started_at', { ascending: false })
        .limit(100);

      if (qErr) {
        setError(qErr.message);
        return;
      }

      const map: Record<string, CronJobRun> = {};
      for (const row of (data ?? []) as CronJobRun[]) {
        if (!map[row.job_name]) {
          map[row.job_name] = row;
        }
      }
      setLatestRuns(map);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load data from Supabase
    void load();
  }, [load]);

  async function runNow(jobName: string) {
    if (!confirm(`Run "${jobName}" now?`)) return;
    setRunningJob(jobName);
    try {
      await invokeFunction(jobName, {});
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningJob(null);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Scheduled jobs</h1>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>{error}</p>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, background: 'white' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ padding: 8 }}>Job</th>
              <th style={{ padding: 8 }}>Schedule</th>
              <th style={{ padding: 8 }}>Last run</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Result</th>
              <th style={{ padding: 8 }} />
            </tr>
          </thead>
          <tbody>
            {JOBS.map((job) => {
              const run = latestRuns[job.name];
              return (
                <tr key={job.name} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: 8 }}>
                    <code style={{ fontSize: 13 }}>{job.name}</code>
                  </td>
                  <td style={{ padding: 8 }}>{job.scheduleLabel}</td>
                  <td style={{ padding: 8 }}>{fmtDate(run?.started_at)}</td>
                  <td style={{ padding: 8 }}>
                    {run ? (
                      <span style={{ color: statusColor(run.status), fontWeight: 600 }}>
                        {run.status}
                      </span>
                    ) : (
                      <span style={{ color: '#6b7280' }}>never</span>
                    )}
                  </td>
                  <td style={{ padding: 8, maxWidth: 260, fontSize: 13 }}>
                    {resultSummary(run)}
                  </td>
                  <td style={{ padding: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={runningJob === job.name}
                      onClick={() => void runNow(job.name)}
                    >
                      {runningJob === job.name ? 'Running…' : 'Run now'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
