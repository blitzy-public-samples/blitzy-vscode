/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { StopWatch } from '../../../../base/common/stopwatch.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * The `component` value carried by every record emitted by {@link FindReplaceWidgetDiagnostics}.
 * Log queries and dashboards filter on this value.
 */
export const FIND_REPLACE_WIDGET_DIAGNOSTICS_COMPONENT = 'findReplaceWidget';

/**
 * The constant message that accompanies every emitted record.
 */
const FIND_REPLACE_WIDGET_DIAGNOSTICS_MESSAGE = 'findReplaceWidget diagnostics';

/**
 * Identifies which in-place find/replace widget a {@link FindReplaceWidgetDiagnostics} instance
 * observes. It is carried by every record and every snapshot, and is the primary dimension for
 * grouping records.
 */
export type FindReplaceWidgetDiagnosticsHost = 'editor' | 'notebook';

/**
 * The find/replace operations counted by {@link FindReplaceWidgetDiagnostics.recordAction}.
 */
export type FindReplaceWidgetDiagnosticsAction = 'find' | 'replaceOne' | 'replaceAll';

/**
 * The kinds of record emitted by {@link FindReplaceWidgetDiagnostics}.
 *
 * - `sessionStart` - a widget session became active.
 * - `health` - a readiness value changed while a session was active.
 * - `action` - a find/replace operation was counted.
 * - `sessionEnd` - a widget session ended; the record also carries the session duration.
 */
export type FindReplaceWidgetDiagnosticsEvent = 'sessionStart' | 'health' | 'action' | 'sessionEnd';

/**
 * A point-in-time view of the state and counters held by {@link FindReplaceWidgetDiagnostics}.
 */
export interface IFindReplaceWidgetDiagnosticsSnapshot {
	/** The widget this snapshot describes. */
	readonly host: FindReplaceWidgetDiagnosticsHost;
	/**
	 * The correlation id shared by every record of the current session, or of the most recently
	 * completed session. It is the empty string until the first session starts.
	 */
	readonly correlationId: string;
	/** Whether a widget session is currently active. */
	readonly sessionActive: boolean;
	/** Whether the widget has finished building its controls. */
	readonly controlsReady: boolean;
	/** Whether the widget has finished subscribing to its find/replace state. */
	readonly stateWired: boolean;
	/** Whether the widget is currently revealed. */
	readonly visible: boolean;
	/** Whether the widget's replace row is currently revealed. */
	readonly replaceVisible: boolean;
	/** The match count most recently reported by the host. */
	readonly matchesCount: number;
	/** The number of find operations counted during the session. */
	readonly findActions: number;
	/** The number of single-replace operations counted during the session. */
	readonly replaceOneActions: number;
	/** The number of replace-all operations counted during the session. */
	readonly replaceAllActions: number;
	/**
	 * The measured duration, in milliseconds, of the most recently completed session. It is `0`
	 * until the first session ends, and `0` again from the moment a new session starts until that
	 * session ends.
	 */
	readonly lastSessionDurationMs: number;
}

/**
 * The structured payload passed to {@link ILogService.trace} for every diagnostics event. It
 * carries every field of {@link IFindReplaceWidgetDiagnosticsSnapshot} in addition to the fields
 * declared here.
 */
export interface IFindReplaceWidgetDiagnosticsRecord extends IFindReplaceWidgetDiagnosticsSnapshot {
	/** Always {@link FIND_REPLACE_WIDGET_DIAGNOSTICS_COMPONENT}. */
	readonly component: typeof FIND_REPLACE_WIDGET_DIAGNOSTICS_COMPONENT;
	/** The kind of event this record describes. */
	readonly event: FindReplaceWidgetDiagnosticsEvent;
	/** The counted operation. Present on `action` records only. */
	readonly action?: FindReplaceWidgetDiagnosticsAction;
	/** The measured session duration in milliseconds. Present on `sessionEnd` records only. */
	readonly durationMs?: number;
}

/**
 * The values a host may write through {@link FindReplaceWidgetDiagnostics.updateSnapshot}. Only
 * the fields present on an update are applied.
 *
 * The host tag, correlation id, session flag, action counters and session duration are maintained
 * by {@link FindReplaceWidgetDiagnostics} and are not writable by a caller.
 */
export interface IFindReplaceWidgetDiagnosticsUpdate {
	/** Whether the widget has finished building its controls. */
	readonly controlsReady?: boolean;
	/** Whether the widget has finished subscribing to its find/replace state. */
	readonly stateWired?: boolean;
	/** Whether the widget is currently revealed. */
	readonly visible?: boolean;
	/** Whether the widget's replace row is currently revealed. */
	readonly replaceVisible?: boolean;
	/** The match count most recently reported by the host. */
	readonly matchesCount?: number;
}

/**
 * Collects operational diagnostics for one in-place find/replace widget.
 *
 * The owning widget drives an instance through four calls: {@link startSession} and
 * {@link endSession} bracket the period the widget is in use, {@link updateSnapshot} reports
 * readiness, visibility and match-count changes, and {@link recordAction} counts find/replace
 * operations. Each emitted event is written to {@link ILogService.trace} as one structured
 * {@link IFindReplaceWidgetDiagnosticsRecord} tagged with the session's correlation id, and the
 * live state and counters are readable at any time through {@link getSnapshot}.
 *
 * Records carry only the host tag, the generated correlation id, and the boolean, numeric and
 * enumerated fields declared by {@link IFindReplaceWidgetDiagnosticsRecord}. Search text,
 * replacement text, matched text, document or cell content, resource identifiers and document
 * metadata are never recorded.
 *
 * The owner registers the instance for disposal.
 *
 * @example
 * ```ts
 * const diagnostics = this._register(new FindReplaceWidgetDiagnostics('editor', logService));
 * diagnostics.updateSnapshot({ controlsReady: true, stateWired: true });
 * diagnostics.startSession();
 * diagnostics.recordAction('find');
 * diagnostics.endSession();
 * ```
 */
export class FindReplaceWidgetDiagnostics extends Disposable {

	private readonly _stopWatch = new StopWatch();

	private _correlationId: string = '';
	private _sessionActive: boolean = false;
	private _controlsReady: boolean = false;
	private _stateWired: boolean = false;
	private _visible: boolean = false;
	private _replaceVisible: boolean = false;
	private _matchesCount: number = 0;
	private _findActions: number = 0;
	private _replaceOneActions: number = 0;
	private _replaceAllActions: number = 0;
	private _lastSessionDurationMs: number = 0;

	/**
	 * @param _host Identifies the widget being observed.
	 * @param _logService Receives every record at trace level.
	 */
	constructor(
		private readonly _host: FindReplaceWidgetDiagnosticsHost,
		private readonly _logService: ILogService
	) {
		super();
	}

	/**
	 * Starts a widget session.
	 *
	 * When a session is already active this call does nothing: no correlation id is generated, no
	 * counter is cleared, the session clock is left running and no record is emitted. Otherwise it
	 * generates a new correlation id, clears the three action counters and the recorded session
	 * duration, restarts the session clock, marks the session active and emits one `sessionStart`
	 * record carrying the current snapshot.
	 */
	public startSession(): void {
		if (this._sessionActive) {
			return;
		}

		this._correlationId = generateUuid();
		this._findActions = 0;
		this._replaceOneActions = 0;
		this._replaceAllActions = 0;
		this._lastSessionDurationMs = 0;
		this._stopWatch.reset();
		this._sessionActive = true;

		this._trace('sessionStart');
	}

	/**
	 * Counts one find/replace operation and emits one `action` record carrying the operation and
	 * the three action counters.
	 *
	 * When no session is active this call does nothing: no counter is incremented and no record is
	 * emitted.
	 *
	 * @param action The operation to count.
	 */
	public recordAction(action: FindReplaceWidgetDiagnosticsAction): void {
		if (!this._sessionActive) {
			return;
		}

		switch (action) {
			case 'find':
				this._findActions++;
				break;
			case 'replaceOne':
				this._replaceOneActions++;
				break;
			case 'replaceAll':
				this._replaceAllActions++;
				break;
			default:
				return;
		}

		this._trace('action', action);
	}

	/**
	 * Applies the readiness, visibility and match-count values reported by the host.
	 *
	 * Only the fields present on `update` are applied. One `health` record is emitted when a call
	 * changes {@link IFindReplaceWidgetDiagnosticsSnapshot.controlsReady} or
	 * {@link IFindReplaceWidgetDiagnosticsSnapshot.stateWired} while a session is active, at most
	 * once per call however many readiness values that call changes. A readiness value written
	 * while no session is active, a value written that equals the value already held, and any
	 * visibility or match-count change are applied without emitting a record.
	 *
	 * @param update The values to apply.
	 */
	public updateSnapshot(update: IFindReplaceWidgetDiagnosticsUpdate): void {
		let readinessChanged = false;

		if (update.controlsReady !== undefined && update.controlsReady !== this._controlsReady) {
			this._controlsReady = update.controlsReady;
			readinessChanged = true;
		}

		if (update.stateWired !== undefined && update.stateWired !== this._stateWired) {
			this._stateWired = update.stateWired;
			readinessChanged = true;
		}

		if (update.visible !== undefined) {
			this._visible = update.visible;
		}

		if (update.replaceVisible !== undefined) {
			this._replaceVisible = update.replaceVisible;
		}

		if (update.matchesCount !== undefined) {
			this._matchesCount = update.matchesCount;
		}

		if (readinessChanged && this._sessionActive) {
			this._trace('health');
		}
	}

	/**
	 * Ends the active widget session.
	 *
	 * When no session is active this call does nothing. Otherwise it stops the session clock, marks
	 * the session inactive, records the measured duration as
	 * {@link IFindReplaceWidgetDiagnosticsSnapshot.lastSessionDurationMs} and emits one
	 * `sessionEnd` record carrying the snapshot and that duration. The completed session's
	 * correlation id and action counters stay readable through {@link getSnapshot} until the next
	 * {@link startSession} replaces them.
	 */
	public endSession(): void {
		if (!this._sessionActive) {
			return;
		}

		this._stopWatch.stop();
		this._sessionActive = false;
		this._lastSessionDurationMs = this._stopWatch.elapsed();

		this._trace('sessionEnd', undefined, this._lastSessionDurationMs);
	}

	/**
	 * Returns the current state and counters.
	 *
	 * The result is a fresh copy: mutating it never changes the state held by this object, and
	 * successive calls return independent objects. This call emits no record.
	 */
	public getSnapshot(): IFindReplaceWidgetDiagnosticsSnapshot {
		return {
			host: this._host,
			correlationId: this._correlationId,
			sessionActive: this._sessionActive,
			controlsReady: this._controlsReady,
			stateWired: this._stateWired,
			visible: this._visible,
			replaceVisible: this._replaceVisible,
			matchesCount: this._matchesCount,
			findActions: this._findActions,
			replaceOneActions: this._replaceOneActions,
			replaceAllActions: this._replaceAllActions,
			lastSessionDurationMs: this._lastSessionDurationMs
		};
	}

	/**
	 * Ends an active session, emitting its `sessionEnd` record and duration, and then disposes this
	 * object.
	 */
	public override dispose(): void {
		this.endSession();
		super.dispose();
	}

	/**
	 * Emits one record for `event` at trace level.
	 *
	 * @param event The kind of event to record.
	 * @param action The counted operation, supplied for `action` events only.
	 * @param durationMs The measured session duration, supplied for `sessionEnd` events only.
	 */
	private _trace(event: FindReplaceWidgetDiagnosticsEvent, action?: FindReplaceWidgetDiagnosticsAction, durationMs?: number): void {
		const record: IFindReplaceWidgetDiagnosticsRecord = {
			component: FIND_REPLACE_WIDGET_DIAGNOSTICS_COMPONENT,
			event,
			...this.getSnapshot(),
			...(action !== undefined ? { action } : {}),
			...(durationMs !== undefined ? { durationMs } : {})
		};

		this._logService.trace(FIND_REPLACE_WIDGET_DIAGNOSTICS_MESSAGE, record);
	}
}
