# Find/replace widget observability

## 1. Scope

This document describes the local, Trace-level diagnostics collected for the two in-place find/replace widgets - the editor widget rooted at `FindWidget` in `findWidget.ts` and the notebook widget rooted at `SimpleFindReplaceWidget` in `src/vs/workbench/contrib/notebook/browser/contrib/find/notebookFindReplaceWidget.ts`. Every signal is produced by `FindReplaceWidgetDiagnostics` in `findReplaceWidgetDiagnostics.ts`. The signals are renderer-local: records are written through `ILogService.trace` and the counters are held in memory. There is no HTTP endpoint, no metrics route, no trace exporter, no alerting rule and no telemetry event. The diagnostics add no user-visible output - no view, notification or status item - and register no command and no setting.

This document records what the diagnostics reuse, what they add, what they emit and how to verify them. The rationale for the design lives in the implementation plan's decision log, which is the single source of truth for why, and is not repeated here.

## 2. Reused and added capability

Reused - existing first-party capability, used as it stands:

| Capability | Source | Used for |
|---|---|---|
| `ILogService` | `src/vs/platform/log/common/log.ts` | Every record is written through `ILogService.trace`, so records reach the log only when the level is `LogLevel.Trace`. |
| `generateUuid` | `src/vs/base/common/uuid.ts` | The per-session correlation id. |
| `StopWatch` | `src/vs/base/common/stopwatch.ts` | Session duration measurement. |
| `Disposable` | `src/vs/base/common/lifecycle.ts` | Lifecycle and ownership; the owning widget registers the instance. |
| Browser unit-test harness | `test/unit/browser/index.js` | Runs the diagnostics suite. No new test infrastructure. |

Added:

| Addition | Location |
|---|---|
| The `FindReplaceWidgetDiagnostics` collaborator. | `src/vs/editor/contrib/find/browser/findReplaceWidgetDiagnostics.ts` |
| Its in-memory snapshot and action-counter surface, exposed by `getSnapshot()`. | Same file. |
| Host-tagged (`editor` / `notebook`) session correlation. | Same file, driven by the call sites in section 5. |
| The diagnostics browser suite that exercises the surface locally. | `src/vs/editor/contrib/find/test/browser/findReplaceWidgetDiagnostics.test.ts` |
| The dashboard and query template. | Section 6 of this document. |

No package was added, removed, or version-bumped: `package.json`, `package-lock.json` and `.npmrc` are unchanged. `findReplaceWidgetDiagnostics.ts` imports only `Disposable`, `StopWatch`, `generateUuid` and `ILogService`; it takes no dependency on `ITelemetryService` and opens no network transport.

## 3. Record schema

Each event emits one structured record, passed as the single argument of an `ILogService.trace` call whose message is the constant `findReplaceWidget diagnostics`. The record type is `IFindReplaceWidgetDiagnosticsRecord`.

| Field | Type | Present on | Meaning |
|---|---|---|---|
| `component` | constant `'findReplaceWidget'`, exported as `FIND_REPLACE_WIDGET_DIAGNOSTICS_COMPONENT` | all events | Filter key. |
| `host` | `'editor'` \| `'notebook'` | all events | Which widget emitted the record. |
| `event` | `'sessionStart'` \| `'health'` \| `'action'` \| `'sessionEnd'` | all events | Record kind. |
| `correlationId` | string, UUID | all events | Ties the records of one widget session together. |
| `action` | `'find'` \| `'replaceOne'` \| `'replaceAll'` | `action` only | Which operation was counted. |
| `durationMs` | number | `sessionEnd` only | Measured session duration in milliseconds. |

`IFindReplaceWidgetDiagnosticsRecord` extends `IFindReplaceWidgetDiagnosticsSnapshot`, so in addition to `component`, `event` and the two event-specific fields, every record carries the complete snapshot field set documented in section 4. `host` and `correlationId` appear in the table above because they are part of that set and therefore ride along on every record.

What each event adds:

- `sessionStart` carries the snapshot as it stands when the session becomes active: `sessionActive` is `true`, and the three action counters and `lastSessionDurationMs` are `0`.
- `health` carries the snapshot including the readiness values that the call changed. It is emitted only when `controlsReady` or `stateWired` changes while a session is active, which is what guarantees that every record carries a correlation id.
- `action` carries `action` plus the three counters `findActions`, `replaceOneActions` and `replaceAllActions`, including the increment the call just applied.
- `sessionEnd` carries `durationMs` and the snapshot, in which `sessionActive` is `false` and `lastSessionDurationMs` equals `durationMs`.

Emission rules:

- `startSession()` is idempotent while a session is active. A second call generates no correlation id, clears no counter, leaves the session clock running and emits no record.
- `endSession()` is a no-op when no session is active.
- `recordAction()` is a no-op when no session is active: no counter moves and no record is emitted.
- `updateSnapshot()` emits at most one `health` record per call, and only for a readiness change made while a session is active. A visibility change, a match-count change, and a readiness value rewritten to the value already held are all applied without emitting a record.
- `getSnapshot()` emits no record.
- `dispose()` ends an active session first, so that session's `sessionEnd` record and duration are emitted before the object is released.

## 4. Snapshot schema

`getSnapshot()` returns an `IFindReplaceWidgetDiagnosticsSnapshot` with these twelve fields.

| Field | Type | Meaning |
|---|---|---|
| `host` | `'editor'` \| `'notebook'` | The widget this snapshot describes. |
| `correlationId` | string | The correlation id shared by every record of the current session, or of the most recently completed session. |
| `sessionActive` | boolean | Whether a widget session is currently active. |
| `controlsReady` | boolean | Whether the widget has finished building its controls. |
| `stateWired` | boolean | Whether the widget has finished subscribing to its find/replace state. |
| `visible` | boolean | Whether the widget is currently revealed. |
| `replaceVisible` | boolean | Whether the widget's replace row is currently revealed. |
| `matchesCount` | number | The match count most recently reported by the host. |
| `findActions` | number | Find operations counted during the session. |
| `replaceOneActions` | number | Single-replace operations counted during the session. |
| `replaceAllActions` | number | Replace-all operations counted during the session. |
| `lastSessionDurationMs` | number | The measured duration, in milliseconds, of the most recently completed session. |

The returned object is a readonly copy: its fields are declared `readonly`, mutating it never changes the state held by the instance, and successive calls return independent objects.

State retained across sessions:

- `correlationId` is the empty string until the first session starts.
- After `endSession()`, the completed session's `correlationId` and its three action counters stay readable until the next `startSession()` replaces them.
- `lastSessionDurationMs` is `0` until the first session ends, and `0` again from the moment a new session starts until that session ends.

## 5. Emission points

| Host | Owner / creator | Session transitions | Snapshot updates | Action counters |
|---|---|---|---|---|
| `editor` | `findController.ts` - `FindController` creates the `'editor'` instance, registers it for disposal, and passes it as the last `FindWidget` constructor argument. | `findWidget.ts`, from the `isRevealed` branch of `_onStateChanged`. | `findWidget.ts` - `controlsReady` and `stateWired` once the DOM is built and the state listener is registered; `visible` on reveal and hide; `replaceVisible` on the replace-row transitions; `matchesCount` on match-count changes. | `findController.ts` only - `moveToNextMatch`, `moveToPrevMatch` and `goToMatch` count `find`, `replace` counts `replaceOne`, and `replaceAll` counts `replaceAll`. Each override delegates to `super`, returns the delegated result unchanged, and counts only when that result was `true`. |
| `notebook` | `notebookFindWidget.ts` - `NotebookFindWidget` constructs the `'notebook'` instance before `super(...)` and passes it to the base shell; `notebookFindReplaceWidget.ts` registers it for disposal. | `notebookFindReplaceWidget.ts` - `reveal`, `show` and `showWithReplace` start a session; `hide` ends it. | `notebookFindReplaceWidget.ts` - `controlsReady` and `stateWired` at the end of construction; `visible` and `replaceVisible` at those show and hide transitions; `matchesCount` from its state-change handler. | `notebookFindWidget.ts` only - at its concrete `find`, `replaceOne` and `replaceAll` boundaries. |

The four call-site files are `src/vs/editor/contrib/find/browser/findController.ts`, `src/vs/editor/contrib/find/browser/findWidget.ts`, `src/vs/workbench/contrib/notebook/browser/contrib/find/notebookFindReplaceWidget.ts` and `src/vs/workbench/contrib/notebook/browser/contrib/find/notebookFindWidget.ts`. The editor widget and the notebook shell hold the collaborator through a type-only import, so neither takes a value dependency on it.

The invariant this split protects: counters are incremented at operation boundaries only, never in a UI button callback. The editor's previous and next buttons run editor actions that route through the controller, so counting in the button callback as well would count one operation twice. For the same reason the widgets update the snapshot but never call `recordAction`, and the controller and the concrete notebook widget count actions but never open or close a session.

## 6. Dashboard and query template

- Filter: `component = 'findReplaceWidget'`.
- Dimensions: `host`, `event`, `action`.
- Measures:
  - Session starts - count of records where `event = 'sessionStart'`.
  - Session ends - count of records where `event = 'sessionEnd'`.
  - Find, replaceOne and replaceAll action counts - count of records where `event = 'action'`, split by `action`. The per-session totals are also readable directly from `findActions`, `replaceOneActions` and `replaceAllActions` on the `sessionEnd` record.
  - Readiness failures - count of records whose readiness condition is false.
  - Session duration average - average of `durationMs` over `sessionEnd` records.
  - Session duration p95 - the 95th percentile of `durationMs` over `sessionEnd` records, where the log backend supports percentiles. Backends without percentile aggregation report the average only.
- Readiness condition: `controlsReady && stateWired`. A record failing it is a readiness failure.
- Visibility treatment: `visible` and `replaceVisible` are displayed as state, never as failure conditions. A widget that is not visible is closed, not broken.

The sketch below is backend-neutral pseudo-query; translate the operators to the dialect of the log backend in use.

```
# Every panel starts from the same filtered stream.
records =
	logs
	| where component == 'findReplaceWidget'

# Panel 1 - event volume.
records
	| summarize records = count() by host, event

# Panel 2 - session starts and ends.
records
	| where event in ('sessionStart', 'sessionEnd')
	| summarize sessions = count() by host, event

# Panel 3 - action mix.
records
	| where event == 'action'
	| summarize actions = count() by host, action

# Panel 4 - readiness.
records
	| where event in ('sessionStart', 'health')
	| extend ready = controlsReady and stateWired
	| summarize records = count(), readinessFailures = countif(not ready) by host, event

# Panel 5 - session duration. Add the percentile term only where the backend supports it.
records
	| where event == 'sessionEnd'
	| summarize avgDurationMs = avg(durationMs), p95DurationMs = percentile(durationMs, 95) by host

# Panel 6 - visibility, reported as state.
records
	| where event in ('sessionStart', 'sessionEnd')
	| summarize records = count() by host, event, visible, replaceVisible
```

| Panel | Measure | Grouping |
|---|---|---|
| 1 | Record volume | `host`, `event` |
| 2 | Session starts and session ends | `host`, `event` |
| 3 | Find, replaceOne and replaceAll action counts | `host`, `action` |
| 4 | Readiness failures against `controlsReady && stateWired` | `host`, `event` |
| 5 | Session-duration average, and p95 where supported | `host` |
| 6 | Visibility and replace visibility as state | `host`, `event`, `visible`, `replaceVisible` |

## 7. Literal-term mapping

| Term | Implemented as |
|---|---|
| Structured logging | Trace records with the stable fields of section 3, one object per event. |
| Distributed tracing | Correlated `sessionStart`, `health`, `action` and `sessionEnd` records sharing one correlation id, plus the measured session duration, within the widget boundary. |
| Metrics endpoint | `getSnapshot()`, which returns the counters and state held in memory. |
| Health and readiness checks | The `controlsReady`, `stateWired`, `sessionActive`, `visible` and `replaceVisible` snapshot fields. |
| Dashboard template | The query and grouping template of section 6. |

## 8. Local verification

The diagnostics browser suite is the local verification. Run these commands, in order:

```
npm run test-browser-no-install -- --browser chromium --runGlob 'vs/editor/contrib/find/test/browser/findReplaceWidget*.test.js'
npm run test-browser-no-install -- --browser chromium --runGlob 'vs/editor/contrib/find/test/browser/*.test.js'
npm run test-browser-no-install -- --browser chromium --run src/vs/workbench/contrib/notebook/test/browser/contrib/find.test.ts
```

The first command runs the two new suites, `Find/Replace Widget Diagnostics` and `Find/Replace Widget Utils`. The second runs every editor find suite in that folder, and the third runs the notebook find suite; both act as regression gates.

The `Find/Replace Widget Diagnostics` suite in `src/vs/editor/contrib/find/test/browser/findReplaceWidgetDiagnostics.test.ts` installs a `NullLogService` subclass that reports `LogLevel.Trace` and overrides `trace` to capture the message and the structured record of every call; it captures calls made above trace level separately, so the suite can assert that the diagnostics write nothing else. It then asserts the record fields, the event sequence, the correlation id and its rotation, the action counters, the readiness records, the measured duration, the record field allow list, the absence of sensitive field names, and every snapshot field. Inspection is done through those assertions. No manual endpoint exists or is expected.

Confirm the **VS Code - Build** watch task reports no compile errors before running any test. `npm run compile` is not the validation shortcut. These compile and lint gates must also pass before the test commands above are run:

```
npm run valid-layers-check
npm run monaco-compile-check
npm run compile-check-ts-native
npm run tsec-compile-check
node_modules/.bin/eslint --no-fix \
	src/vs/editor/contrib/find/browser/findReplaceWidgetUtils.ts \
	src/vs/editor/contrib/find/browser/findReplaceWidgetDiagnostics.ts \
	src/vs/editor/contrib/find/browser/findWidget.ts \
	src/vs/editor/contrib/find/browser/findController.ts \
	src/vs/editor/contrib/find/test/browser/findReplaceWidgetUtils.test.ts \
	src/vs/editor/contrib/find/test/browser/findReplaceWidgetDiagnostics.test.ts \
	src/vs/workbench/contrib/notebook/browser/contrib/find/notebookFindReplaceWidget.ts \
	src/vs/workbench/contrib/notebook/browser/contrib/find/notebookFindWidget.ts
npm run hygiene
```

Environment: Node.js `22.20.0` exactly, as pinned by `.nvmrc`, with dependencies installed by `npm ci` so that the settings in `.npmrc` apply.

## 9. Privacy

Records never contain search strings, replacement strings, matched text, document or cell content, resource URIs, or document metadata. The only values emitted are the enumerated `component`, `host`, `event` and `action` tags, the boolean and numeric snapshot fields listed in section 4, the `durationMs` measurement, and the generated correlation id. The correlation id is a fresh UUID per session and identifies nothing outside the log stream.

No telemetry event is sent. `publicLog2` requires prior privacy approval, which this change does not have, so `ITelemetryService` is not used and the diagnostics reach the log stream only.
