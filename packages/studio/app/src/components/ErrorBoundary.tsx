import { Component, type ReactNode } from "react";
import { ErrorNote } from "./feedback.js";

/**
 * A page that fails to load or to draw says so, instead of a blank screen: often a page
 * file the last build replaced, which a reload fetches again.
 */
export class ErrorBoundary extends Component<
	{ children: ReactNode },
	{ error?: Error }
> {
	override state: { error?: Error } = {};

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	override render() {
		if (!this.state.error) return this.props.children;
		return (
			<div className="px-4 py-6 sm:px-8 sm:py-8">
				<ErrorNote>
					<p>This page could not be shown: {this.state.error.message}</p>
					<button
						type="button"
						onClick={() => window.location.reload()}
						className="btn mt-3 h-7 text-xs"
					>
						Reload
					</button>
				</ErrorNote>
			</div>
		);
	}
}
