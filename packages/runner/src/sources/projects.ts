import type { Factory, FactoryEvent } from "@openfabriq/core";
import { listProjects } from "../state/projects.js";

/** A project and the factory it applied: what an event from the relay is matched against. */
export interface AppliedProject {
	repository: string;
	factory: Factory;
}

/** An event to queue for one project. */
export interface ProjectEvent extends AppliedProject {
	event: FactoryEvent;
}

/** The projects whose applied factory loads, in the order they are listed. */
export const appliedProjects = (
	appliedFactory: (repo: string) => Factory | undefined,
): AppliedProject[] =>
	listProjects().flatMap(({ repository }) => {
		const factory = appliedFactory(repository);
		return factory ? [{ repository, factory }] : [];
	});
