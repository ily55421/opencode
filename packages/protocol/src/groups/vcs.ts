import { FileDiff } from "@opencode/schema/file-diff"
import { Location } from "@opencode/schema/location"
import { NonNegativeInt, PositiveInt, optional } from "@opencode/schema/schema"
import { Vcs } from "@opencode/schema/vcs"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { LocationQuery, locationQueryOpenApi } from "./location.js"
import { ConflictError, InvalidRequestError, ServiceUnavailableError } from "../errors.js"

const InitQuery = Schema.Struct({
  ...LocationQuery.fields,
  provider: Schema.optional(Schema.String),
})

export class VcsInitNotSupportedError extends Schema.TaggedError<VcsInitNotSupportedError>()(
  "VcsInitNotSupportedError",
  { providerID: Schema.String, message: Schema.String },
  { httpApiStatus: 501 },
) {}

/** The repository refused, or the provider cannot write. Carries Git's own words so a person can act on them. */
export class VcsOperationError extends Schema.TaggedError<VcsOperationError>()("VcsOperationError", {
  message: Schema.String,
  operation: Schema.Literals(["commit", "push"]),
}) {}

const BranchesQuery = Schema.Struct({
  ...LocationQuery.fields,
  search: Schema.optional(Schema.String),
  limit: Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional),
})

const DiffQuery = Schema.Struct({
  ...LocationQuery.fields,
  mode: Vcs.Mode,
  base: optional(Schema.String),
  context: Schema.NumberFromString.pipe(Schema.decodeTo(NonNegativeInt), Schema.optional),
  untracked: optional(Vcs.Untracked),
})

export const VcsGroup = HttpApiGroup.make("server.vcs")
  .add(
    HttpApiEndpoint.post("vcs.init", "/api/vcs/init", {
      query: InitQuery,
      success: HttpApiSchema.NoContent,
      error: [ConflictError, InvalidRequestError, VcsInitNotSupportedError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "vcs.init",
          summary: "Initialize VCS repository",
          description:
            "Initialize a repository using the selected VCS provider in a markerless project's directory and refresh its location services. Omitting provider defaults to git; built-in git and hg providers support initialization. An unknown provider returns 400; a registered provider without init returns 501.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("vcs.get", "/api/vcs", {
      query: LocationQuery,
      success: Location.response(Vcs.Info),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "vcs.get",
          summary: "VCS info",
          description: "Get current and default branch information for the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("vcs.base", "/api/vcs/base", {
      query: LocationQuery,
      success: Location.response(Schema.NullOr(Vcs.Base)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "vcs.base",
          summary: "VCS review base",
          description:
            "Infer a local review base from named branch creation history, or the repository default only when currently on that branch. Returns null before the first commit or when the provider lacks base metadata; ambiguous Git history requires an explicit base on diff requests.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("vcs.status", "/api/vcs/status", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Vcs.FileStatus)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "vcs.status",
          summary: "VCS status",
          description: "List uncommitted working-copy changes relative to the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("vcs.branch.list", "/api/vcs/branch", {
      query: BranchesQuery,
      success: Location.response(Vcs.BranchList),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "vcs.branch.list",
          summary: "VCS branches",
          description: "List local and remote branches available at the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("vcs.diff", "/api/vcs/diff", {
      query: DiffQuery,
      success: Location.response(Schema.Array(FileDiff.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "vcs.diff",
          summary: "VCS diff",
          description:
            "Diff HEAD to the working copy (working), the base merge-base to the working copy (branch), or the base merge-base to HEAD (committed). Omitting base preserves repository-default comparison; supplying it overrides the comparison without saving it.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("vcs.commit", "/api/vcs/commit", {
      query: LocationQuery,
      payload: Vcs.CommitInput,
      success: Location.response(Vcs.CommitResult),
      error: [InvalidRequestError, VcsOperationError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "vcs.commit",
          summary: "Commit listed paths",
          description:
            "Commit exactly the listed worktree-relative paths with the given message, leaving anything else a person staged untouched. Hooks run; nothing here forces or skips them. Returns the new commit and how many paths it carried.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("vcs.push", "/api/vcs/push", {
      query: LocationQuery,
      payload: Vcs.PushInput,
      success: Location.response(Vcs.PushResult),
      error: [InvalidRequestError, VcsOperationError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "vcs.push",
          summary: "Push current branch",
          description:
            "Push the checked-out branch to the named remote, or the repository's primary remote, with an explicit refspec. Never forces, and a rejected push returns the remote's message.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "vcs",
      description: "Location-scoped version control routes.",
    }),
  )
