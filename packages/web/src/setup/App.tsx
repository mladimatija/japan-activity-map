import { useEffect, useRef, useState } from 'react';

import { Alert, AlertDescription } from '../components/ui/alert.tsx';
import { Button } from '../components/ui/button.tsx';
import { setTranslationLang, t } from '../i18n.ts';
import {
  MARKER,
  type PlanAction,
  type SetupApi,
  type SetupState,
  type Start,
  type View,
} from './api.ts';
import { Review } from './Review.tsx';
import { RunPanel } from './RunPanel.tsx';
import { Done, Screen, Steps, Trail, Welcome } from './screens.tsx';

type ScreenName = 'welcome' | 'steps' | 'run' | 'review' | 'done';

/** The setup's stages, as the trail at the top names them. */
const FLOW = { steps: 'Answer', run: 'Run', review: 'Review', done: 'Done' } as const;
const FLOW_ORDER: (keyof typeof FLOW)[] = ['steps', 'run', 'review', 'done'];

/** Answers that must not outlive the save: typed secrets and a clicked position. */
const SENSITIVE = ['strava.clientId', 'strava.clientSecret', 'privacy.home', 'privacy.zones'];

/**
 * The setup page. Everything it knows is in this component's state: nothing is written to the
 * browser's storage, and secrets and positions are dropped from memory once saved.
 */
export const SetupApp = ({ api }: { api: SetupApi }) => {
  const [lang, setLang] = useState<'en' | 'ja'>('en');
  const [screen, setScreen] = useState<ScreenName>('welcome');
  const [state, setState] = useState<SetupState>();
  const [start, setStart] = useState<Start>('quick');
  const [group, setGroup] = useState<string>();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [view, setView] = useState<View>();
  const [page, setPage] = useState(0);
  const [plan, setPlan] = useState<PlanAction[]>([]);
  const [saving, setSaving] = useState(false);
  const [closed, setClosed] = useState(false);
  const [problem, setProblem] = useState<string>();
  const latest = useRef(0);

  const fail = (error: unknown) =>
    setProblem(error instanceof Error ? error.message : String(error));
  const refresh = () => api.state().then(setState, fail);
  useEffect(() => {
    void refresh();
    // Once, when the page opens.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Each change is checked by the server a moment after typing stops; only the newest answer counts.
  useEffect(() => {
    if (screen !== 'steps') return undefined;
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      api.answers({ start, ...(group ? { group } : {}), answers }).then((next) => {
        if (ticket === latest.current) setView(next);
      }, fail);
    }, 250);
    return () => clearTimeout(timer);
  }, [api, screen, start, group, answers]);

  const begin = (next: Start, nextGroup?: string) => {
    setStart(next);
    setGroup(nextGroup);
    setAnswers({});
    setView(undefined);
    setPage(0);
    setProblem(undefined);
    setScreen('steps');
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.apply({ start, ...(group ? { group } : {}), answers });
      // Saved: the page forgets what it must not keep.
      setAnswers((before) =>
        Object.fromEntries(Object.entries(before).filter(([id]) => !SENSITIVE.includes(id))),
      );
      setPlan(result.plan);
      await refresh();
      setScreen(result.plan.length > 0 ? 'run' : 'done');
    } catch (error) {
      fail(error);
    } finally {
      setSaving(false);
    }
  };

  const switchLang = (next: 'en' | 'ja') => {
    setTranslationLang(next);
    setLang(next);
  };

  return (
    <div lang={lang} data-app={MARKER} className="min-h-dvh bg-background text-sm text-foreground">
      <header className="flex items-center gap-3 border-b bg-card px-4 py-2.5">
        <h1 className="flex min-w-0 flex-1 items-center gap-2.5 text-row font-bold">
          {/* The map's "done" pin, as the page's mark. */}
          <span
            aria-hidden
            className="size-3.5 shrink-0 rounded-full border-2 border-card bg-status-done ring-2 ring-status-done"
          />
          <span className="truncate">{t('Japan Activity Map setup')}</span>
        </h1>
        {screen !== 'welcome' && !closed && (
          <Button variant="ghost" size="sm" onClick={() => setScreen('welcome')}>
            {t('Start over')}
          </Button>
        )}
        <div role="group" aria-label={t('Language')} className="flex gap-1">
          {(['en', 'ja'] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant="outline"
              aria-pressed={lang === option}
              lang={option}
              className={lang === option ? 'border-primary bg-accent text-accent-foreground' : ''}
              onClick={() => switchLang(option)}
            >
              {option === 'en' ? 'EN' : '日本語'}
            </Button>
          ))}
        </div>
      </header>
      <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-8 md:px-6">
        {state && screen !== 'welcome' && (
          <Trail
            label={t('Where you are in the setup')}
            points={(start === 'demo'
              ? FLOW_ORDER.filter((name) => name !== 'review')
              : FLOW_ORDER
            ).map((name, index, all) => ({
              label: t(FLOW[name]),
              state:
                all.findIndex((entry) => entry === screen) > index
                  ? ('done' as const)
                  : name === screen
                    ? ('now' as const)
                    : ('todo' as const),
            }))}
          />
        )}
        {problem && (
          <Alert variant="destructive">
            <AlertDescription>
              {t('The setup command did not answer: {problem}', { problem })}
            </AlertDescription>
          </Alert>
        )}
        {!state ? (
          <p className="text-sm text-muted-foreground">{t('Asking the setup command…')}</p>
        ) : screen === 'welcome' ? (
          <Welcome state={state} onStart={begin} />
        ) : screen === 'steps' ? (
          <Screen
            title={
              start === 'demo'
                ? t('Demo data')
                : start === 'quick'
                  ? t('Quick setup')
                  : start === 'full'
                    ? t('Full setup')
                    : t('Change settings')
            }
          >
            {view ? (
              <Steps
                start={start}
                view={view}
                state={state}
                answers={answers}
                page={page}
                saving={saving}
                onAnswer={(id, value) => setAnswers((before) => ({ ...before, [id]: value }))}
                onPage={setPage}
                onSave={() => void save()}
                onBack={() => setScreen('welcome')}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t('Asking the setup command…')}</p>
            )}
          </Screen>
        ) : screen === 'run' ? (
          <Screen
            title={t('Run')}
            lead={t('The config files are saved. These commands do the rest, one after another.')}
          >
            <RunPanel
              api={api}
              plan={plan}
              scope={state.facts.stravaScope}
              onFinished={() => {
                void refresh();
                setScreen(start === 'demo' ? 'done' : 'review');
              }}
            />
          </Screen>
        ) : screen === 'review' ? (
          <Screen
            title={t('Review')}
            lead={t('What the commands could not settle on their own is written to these files.')}
          >
            <Review
              api={api}
              reviews={state.reviews}
              mapStyle={state.mapStyle}
              onNext={() => setScreen('done')}
            />
          </Screen>
        ) : (
          <Done
            closed={closed}
            demo={start === 'demo'}
            onFinish={() => {
              api.shutdown(true).then(() => setClosed(true), fail);
            }}
          />
        )}
      </main>
    </div>
  );
};
