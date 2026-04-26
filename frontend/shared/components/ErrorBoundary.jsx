import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  componentDidUpdate(prevProps) {
    // Allow the parent to reset the boundary by changing resetKey.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  reset() {
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-gray-900 text-gray-200">
          <div className="text-sm">Something went wrong in this panel. Check the console.</div>
          <button
            onClick={this.reset}
            className="rounded-md bg-rwendo-accent px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
