import { Component, type ErrorInfo, type ReactNode } from "react";

export interface PosErrorBoundaryProps {
  children: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

export interface PosErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export const POS_ERROR_BOUNDARY_TITLE = "POS screen needs attention";
export const POS_ERROR_BOUNDARY_OPERATOR_MESSAGE =
  "The cashier screen hit an unexpected error. Please reload the POS. If the problem continues, call the manager before continuing service.";

export class PosErrorBoundary extends Component<PosErrorBoundaryProps, PosErrorBoundaryState> {
  override state: PosErrorBoundaryState = {
    hasError: false,
    message: POS_ERROR_BOUNDARY_OPERATOR_MESSAGE,
  };

  static getDerivedStateFromError(error: Error): PosErrorBoundaryState {
    return {
      hasError: true,
      message: createPosErrorBoundaryMessage(error),
    };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="pos-shell error-boundary-shell" role="alert" aria-live="assertive">
        <section className="error-boundary-card">
          <p className="eyebrow">Offline sales are protected locally</p>
          <h1>{POS_ERROR_BOUNDARY_TITLE}</h1>
          <p>{this.state.message}</p>
          <div className="error-boundary-actions">
            <button type="button" onClick={() => globalThis.location?.reload()}>
              Reload POS
            </button>
            <span>Call manager if this repeats.</span>
          </div>
        </section>
      </main>
    );
  }
}

export function createPosErrorBoundaryMessage(error: Error): string {
  const safeDetails = error.message.trim();
  if (!safeDetails) return POS_ERROR_BOUNDARY_OPERATOR_MESSAGE;

  return `${POS_ERROR_BOUNDARY_OPERATOR_MESSAGE} Technical detail: ${safeDetails}`;
}
