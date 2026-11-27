import { Component, type ErrorInfo, type ReactNode } from 'react';

import { t } from '../i18n.ts';
import { Empty } from './app.tsx';
import { Button } from './ui/button.tsx';

interface Props {
  children: ReactNode;
  /** When this changes (another page, say) a caught error is cleared and the children tried again. */
  resetKey?: string;
  /** Fills the screen, for the boundary round the whole app. */
  whole?: boolean;
}

interface State {
  failed: boolean;
  /** A part of the site that did not load, as after a new version was published. */
  stale: boolean;
  resetKey: string | undefined;
}

/**
 * Catches an error under it and says so, with a way to load the site again, instead of leaving a
 * blank page. A chunk that fails to load is the usual cause: the site was rebuilt while this tab
 * was open, and the file it asks for is gone.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, stale: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    const message = error instanceof Error ? error.message : String(error);
    return {
      failed: true,
      stale: /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
        message,
      ),
    };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey
      ? null
      : { failed: false, stale: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className={this.props.whole ? 'grid h-dvh place-items-center' : undefined}>
        <Empty
          action={
            <Button variant="outline" onClick={() => globalThis.location.reload()}>
              {t('Load again')}
            </Button>
          }
        >
          {this.state.stale
            ? t('The site has been updated since this page was opened. Load it again to carry on.')
            : t('Something went wrong showing this. Loading the page again usually fixes it.')}
        </Empty>
      </div>
    );
  }
}
