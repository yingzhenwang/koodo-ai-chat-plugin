import React from "react";

interface Props {
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div style={{ padding: 20, opacity: 0.6, textAlign: "center" }}>
            Something went wrong. Please close and reopen the AI panel.
          </div>
        )
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
