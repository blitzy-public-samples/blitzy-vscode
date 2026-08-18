/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { isUUID } from '../../../../../base/common/uuid.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { LogLevel, NullLogService } from '../../../../../platform/log/common/log.js';
import { FIND_REPLACE_WIDGET_DIAGNOSTICS_COMPONENT, FindReplaceWidgetDiagnostics, FindReplaceWidgetDiagnosticsAction, FindReplaceWidgetDiagnosticsEvent, FindReplaceWidgetDiagnosticsHost, IFindReplaceWidgetDiagnosticsRecord, IFindReplaceWidgetDiagnosticsSnapshot } from '../../browser/findReplaceWidgetDiagnostics.js';

/**
 * A record captured from a trace call. The index signature lets a test enumerate a record's own
 * fields and read them by a field name held in a variable.
 */
type CapturedRecord = IFindReplaceWidgetDiagnosticsRecord & { readonly [field: string]: string | number | boolean | undefined };

/**
 * A writable view of a snapshot, used to attempt a mutation of a value returned by
 * {@link FindReplaceWidgetDiagnostics.getSnapshot}.
 */
type MutableSnapshot = { -readonly [K in keyof IFindReplaceWidgetDiagnosticsSnapshot]: IFindReplaceWidgetDiagnosticsSnapshot[K] };

/**
 * The complete field set of {@link IFindReplaceWidgetDiagnosticsSnapshot}. Every record carries
 * these fields in addition to its own.
 */
const SNAPSHOT_FIELDS: readonly string[] = [
	'host',
	'correlationId',
	'sessionActive',
	'controlsReady',
	'stateWired',
	'visible',
	'replaceVisible',
	'matchesCount',
	'findActions',
	'replaceOneActions',
	'replaceAllActions',
	'lastSessionDurationMs'
];

/** The fields every record carries, whatever event it reports. */
const COMMON_RECORD_FIELDS: readonly string[] = ['component', 'event', ...SNAPSHOT_FIELDS];

/** Every field name a record is allowed to carry. */
const ALLOWED_RECORD_FIELDS: readonly string[] = [...COMMON_RECORD_FIELDS, 'action', 'durationMs'];

/**
 * Field names that would carry search text, replacement text, matched or document content, a
 * resource identifier or document metadata into a record. No record may carry any of them.
 */
const SENSITIVE_RECORD_FIELDS: readonly string[] = [
	'searchString',
	'replaceString',
	'matchedText',
	'text',
	'content',
	'value',
	'query',
	'uri',
	'resource',
	'path',
	'fileName',
	'lineContent',
	'selection',
	'languageId'
];

/** Every event value a record may report. */
const RECORD_EVENTS: readonly FindReplaceWidgetDiagnosticsEvent[] = ['sessionStart', 'health', 'action', 'sessionEnd'];

/** Every operation a session counts. */
const RECORD_ACTIONS: readonly FindReplaceWidgetDiagnosticsAction[] = ['find', 'replaceOne', 'replaceAll'];

/** Every host a diagnostics instance may observe. */
const RECORD_HOSTS: readonly FindReplaceWidgetDiagnosticsHost[] = ['editor', 'notebook'];

/**
 * An `ILogService` double that captures the message and the structured record of every trace call,
 * and captures the message of every call made above trace level separately. It reports
 * {@link LogLevel.Trace} as its level.
 */
class RecordingLogService extends NullLogService {

	/** The message of every captured trace call, in call order. */
	readonly messages: string[] = [];

	/** The structured record argument of every captured trace call, in call order. */
	readonly records: CapturedRecord[] = [];

	/** The message of every captured call made above trace level, in call order. */
	readonly messagesAboveTrace: string[] = [];

	override getLevel(): LogLevel {
		return LogLevel.Trace;
	}

	override trace(message: string, ...args: unknown[]): void {
		this.messages.push(message);
		for (const arg of args) {
			this.records.push(arg as CapturedRecord);
		}
	}

	override debug(message: string, ...args: unknown[]): void {
		this.messagesAboveTrace.push(message);
	}

	override info(message: string, ...args: unknown[]): void {
		this.messagesAboveTrace.push(message);
	}

	override warn(message: string, ...args: unknown[]): void {
		this.messagesAboveTrace.push(message);
	}

	override error(message: string | Error, ...args: unknown[]): void {
		this.messagesAboveTrace.push(String(message));
	}

	/** The captured records reporting `event`, in emission order. */
	recordsOf(event: FindReplaceWidgetDiagnosticsEvent): readonly CapturedRecord[] {
		return this.records.filter(record => record.event === event);
	}

	/** The single captured record reporting `event`, asserting that exactly one was emitted. */
	singleRecordOf(event: FindReplaceWidgetDiagnosticsEvent): CapturedRecord {
		const matching = this.recordsOf(event);
		assert.strictEqual(matching.length, 1, `exactly one ${event} record`);
		return matching[0];
	}
}

/** Asserts `value` is a finite, non-negative millisecond measurement. */
function assertMeasuredDuration(value: string | number | boolean | undefined, description: string): void {
	if (typeof value !== 'number') {
		assert.fail(`${description} is not a number: ${String(value)}`);
	}

	assert.ok(Number.isFinite(value), `${description} is not finite: ${value}`);
	assert.ok(value >= 0, `${description} is negative: ${value}`);
}

/** Asserts `record` carries exactly the fields in `expected`, in any order. */
function assertRecordFields(record: CapturedRecord, expected: readonly string[]): void {
	assert.deepStrictEqual(
		Object.keys(record).sort(),
		[...expected].sort(),
		`field set of the ${record.event} record`
	);
}

/**
 * Asserts the schema and privacy guarantees every record must satisfy: the fixed component tag,
 * the observed host, a known event, a correlation id in UUID form, only allow-listed field names,
 * no sensitive field name, and only primitive field values.
 */
function assertRecordContract(record: CapturedRecord, host: FindReplaceWidgetDiagnosticsHost): void {
	assert.strictEqual(record.component, FIND_REPLACE_WIDGET_DIAGNOSTICS_COMPONENT, 'record component');
	assert.strictEqual(record.host, host, 'record host');
	assert.ok(RECORD_EVENTS.includes(record.event), `record reports a known event: ${record.event}`);
	assert.strictEqual(typeof record.correlationId, 'string', 'record correlation id is a string');
	assert.ok(isUUID(record.correlationId), `record is correlated: ${record.correlationId}`);

	for (const field of Object.keys(record)) {
		assert.ok(ALLOWED_RECORD_FIELDS.includes(field), `record field is allow-listed: ${field}`);
		assert.ok(!SENSITIVE_RECORD_FIELDS.includes(field), `record omits the sensitive field: ${field}`);

		const value = record[field];
		const isPrimitive = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
		assert.ok(isPrimitive, `record field holds a primitive value: ${field}=${String(value)}`);
	}
}

suite('Find/Replace Widget Diagnostics', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	interface IDiagnosticsUnderTest {
		readonly logger: RecordingLogService;
		readonly diagnostics: FindReplaceWidgetDiagnostics;
	}

	/** Creates a registered diagnostics instance for `host` together with its capturing logger. */
	function create(host: FindReplaceWidgetDiagnosticsHost): IDiagnosticsUnderTest {
		const logger = new RecordingLogService();
		const diagnostics = store.add(new FindReplaceWidgetDiagnostics(host, logger));
		return { logger, diagnostics };
	}

	suite('snapshot surface', () => {

		test('exposes exactly the documented fields', () => {
			const { diagnostics } = create('editor');

			assert.deepStrictEqual(
				Object.keys(diagnostics.getSnapshot()).sort(),
				[...SNAPSHOT_FIELDS].sort()
			);
		});

		test('reports the initial state of an editor widget', () => {
			const { logger, diagnostics } = create('editor');
			const snapshot = diagnostics.getSnapshot();

			assert.strictEqual(snapshot.host, 'editor');
			assert.strictEqual(snapshot.correlationId, '');
			assert.strictEqual(snapshot.sessionActive, false);
			assert.strictEqual(snapshot.controlsReady, false);
			assert.strictEqual(snapshot.stateWired, false);
			assert.strictEqual(snapshot.visible, false);
			assert.strictEqual(snapshot.replaceVisible, false);
			assert.strictEqual(snapshot.matchesCount, 0);
			assert.strictEqual(snapshot.findActions, 0);
			assert.strictEqual(snapshot.replaceOneActions, 0);
			assert.strictEqual(snapshot.replaceAllActions, 0);
			assert.strictEqual(snapshot.lastSessionDurationMs, 0);
			assert.strictEqual(logger.records.length, 0, 'reading a snapshot emits no record');
		});

		test('reports the host tag of a notebook widget', () => {
			const { diagnostics } = create('notebook');

			assert.strictEqual(diagnostics.getSnapshot().host, 'notebook');
		});

		test('reports every field a host writes', () => {
			const { diagnostics } = create('editor');

			diagnostics.updateSnapshot({
				controlsReady: true,
				stateWired: true,
				visible: true,
				replaceVisible: true,
				matchesCount: 17
			});
			diagnostics.startSession();
			diagnostics.recordAction('find');
			diagnostics.recordAction('replaceOne');
			diagnostics.recordAction('replaceOne');
			diagnostics.recordAction('replaceAll');
			diagnostics.endSession();

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.host, 'editor');
			assert.ok(isUUID(snapshot.correlationId), `correlation id: ${snapshot.correlationId}`);
			assert.strictEqual(snapshot.sessionActive, false);
			assert.strictEqual(snapshot.controlsReady, true);
			assert.strictEqual(snapshot.stateWired, true);
			assert.strictEqual(snapshot.visible, true);
			assert.strictEqual(snapshot.replaceVisible, true);
			assert.strictEqual(snapshot.matchesCount, 17);
			assert.strictEqual(snapshot.findActions, 1);
			assert.strictEqual(snapshot.replaceOneActions, 2);
			assert.strictEqual(snapshot.replaceAllActions, 1);
			assertMeasuredDuration(snapshot.lastSessionDurationMs, 'lastSessionDurationMs');
		});

		test('returns an independent object on every call', () => {
			const { diagnostics } = create('editor');

			assert.notStrictEqual(
				diagnostics.getSnapshot(),
				diagnostics.getSnapshot(),
				'successive snapshots are distinct objects'
			);
		});

		test('returns a copy that a caller cannot write back through', () => {
			const { diagnostics } = create('editor');

			diagnostics.updateSnapshot({ matchesCount: 3 });
			diagnostics.startSession();

			const snapshot = diagnostics.getSnapshot();
			const mutable = snapshot as MutableSnapshot;
			mutable.host = 'notebook';
			mutable.correlationId = 'not-a-correlation-id';
			mutable.sessionActive = false;
			mutable.controlsReady = true;
			mutable.stateWired = true;
			mutable.visible = true;
			mutable.replaceVisible = true;
			mutable.matchesCount = 4242;
			mutable.findActions = 99;
			mutable.replaceOneActions = 99;
			mutable.replaceAllActions = 99;
			mutable.lastSessionDurationMs = 99;

			const reread = diagnostics.getSnapshot();
			assert.strictEqual(reread.host, 'editor');
			assert.notStrictEqual(reread.correlationId, 'not-a-correlation-id');
			assert.strictEqual(reread.sessionActive, true);
			assert.strictEqual(reread.controlsReady, false);
			assert.strictEqual(reread.stateWired, false);
			assert.strictEqual(reread.visible, false);
			assert.strictEqual(reread.replaceVisible, false);
			assert.strictEqual(reread.matchesCount, 3);
			assert.strictEqual(reread.findActions, 0);
			assert.strictEqual(reread.replaceOneActions, 0);
			assert.strictEqual(reread.replaceAllActions, 0);
			assert.strictEqual(reread.lastSessionDurationMs, 0);
		});
	});

	suite('session lifecycle', () => {

		test('starting a session activates it, correlates it and emits one sessionStart record', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.sessionActive, true);
			assert.ok(isUUID(snapshot.correlationId), `correlation id: ${snapshot.correlationId}`);

			const record = logger.singleRecordOf('sessionStart');
			assert.strictEqual(logger.records.length, 1, 'starting a session emits one record');
			assert.strictEqual(record.correlationId, snapshot.correlationId);
			assert.strictEqual(record.sessionActive, true);
			assertRecordContract(record, 'editor');
			assertRecordFields(record, COMMON_RECORD_FIELDS);
		});

		test('starting a session is idempotent while one is active', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			const first = diagnostics.getSnapshot();
			diagnostics.recordAction('find');
			diagnostics.recordAction('replaceAll');

			diagnostics.startSession();

			const second = diagnostics.getSnapshot();
			assert.strictEqual(second.correlationId, first.correlationId, 'the correlation id is kept');
			assert.strictEqual(second.sessionActive, true);
			assert.strictEqual(second.findActions, 1, 'the find counter is kept');
			assert.strictEqual(second.replaceAllActions, 1, 'the replace-all counter is kept');
			assert.strictEqual(logger.recordsOf('sessionStart').length, 1, 'no second sessionStart record');
		});

		test('ending a session deactivates it and emits one sessionEnd record', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.endSession();

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.sessionActive, false);

			const record = logger.singleRecordOf('sessionEnd');
			assert.strictEqual(record.correlationId, snapshot.correlationId);
			assert.strictEqual(record.sessionActive, false);
			assert.strictEqual(record.durationMs, snapshot.lastSessionDurationMs);
			assertRecordContract(record, 'editor');
			assertRecordFields(record, [...COMMON_RECORD_FIELDS, 'durationMs']);
		});

		test('ending a session is a no-op before any session started', () => {
			const { logger, diagnostics } = create('editor');
			const before = diagnostics.getSnapshot();

			diagnostics.endSession();

			assert.deepStrictEqual(diagnostics.getSnapshot(), before, 'nothing observable changed');
			assert.strictEqual(logger.records.length, 0, 'no record was emitted');
		});

		test('ending a session twice in a row changes nothing the second time', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.endSession();
			const afterFirstEnd = diagnostics.getSnapshot();
			const recordCount = logger.records.length;

			diagnostics.endSession();

			assert.deepStrictEqual(diagnostics.getSnapshot(), afterFirstEnd, 'nothing observable changed');
			assert.strictEqual(logger.records.length, recordCount, 'no extra record was emitted');
			assert.strictEqual(logger.recordsOf('sessionEnd').length, 1, 'exactly one sessionEnd record');
		});

		test('a completed session keeps its correlation id and counters readable', () => {
			const { diagnostics } = create('editor');

			diagnostics.startSession();
			const activeCorrelationId = diagnostics.getSnapshot().correlationId;
			diagnostics.recordAction('find');
			diagnostics.recordAction('find');
			diagnostics.recordAction('replaceOne');
			diagnostics.recordAction('replaceAll');
			diagnostics.endSession();

			const completed = diagnostics.getSnapshot();
			assert.strictEqual(completed.sessionActive, false);
			assert.strictEqual(completed.correlationId, activeCorrelationId, 'the id is retained');
			assert.strictEqual(completed.findActions, 2, 'the find counter is retained');
			assert.strictEqual(completed.replaceOneActions, 1, 'the replace-one counter is retained');
			assert.strictEqual(completed.replaceAllActions, 1, 'the replace-all counter is retained');
			assert.deepStrictEqual(diagnostics.getSnapshot(), completed, 'a later read is unchanged');
		});

		test('a new session rotates the correlation id and resets the counters and duration', () => {
			const { diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.recordAction('find');
			diagnostics.recordAction('replaceOne');
			diagnostics.recordAction('replaceAll');
			diagnostics.endSession();
			const completed = diagnostics.getSnapshot();

			diagnostics.startSession();

			const restarted = diagnostics.getSnapshot();
			assert.ok(isUUID(restarted.correlationId), `correlation id: ${restarted.correlationId}`);
			assert.notStrictEqual(restarted.correlationId, completed.correlationId, 'the id rotated');
			assert.strictEqual(restarted.sessionActive, true);
			assert.strictEqual(restarted.findActions, 0);
			assert.strictEqual(restarted.replaceOneActions, 0);
			assert.strictEqual(restarted.replaceAllActions, 0);
			assert.strictEqual(restarted.lastSessionDurationMs, 0, 'the prior duration was cleared');
		});

		test('measures a finite, non-negative duration for a completed session', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.endSession();

			const duration = diagnostics.getSnapshot().lastSessionDurationMs;
			assertMeasuredDuration(duration, 'lastSessionDurationMs');
			assertMeasuredDuration(logger.singleRecordOf('sessionEnd').durationMs, 'sessionEnd durationMs');
			assert.strictEqual(logger.singleRecordOf('sessionEnd').durationMs, duration);
		});

		test('brackets a notebook widget session with the same records', () => {
			const { logger, diagnostics } = create('notebook');

			diagnostics.startSession();
			diagnostics.endSession();

			assertRecordContract(logger.singleRecordOf('sessionStart'), 'notebook');
			assertRecordContract(logger.singleRecordOf('sessionEnd'), 'notebook');
			assert.strictEqual(logger.records.length, 2);
		});
	});


	suite('action counters', () => {

		test('counting a find action increments only the find counter', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.recordAction('find');

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.findActions, 1);
			assert.strictEqual(snapshot.replaceOneActions, 0);
			assert.strictEqual(snapshot.replaceAllActions, 0);

			const record = logger.singleRecordOf('action');
			assert.strictEqual(record.action, 'find');
			assert.strictEqual(record.findActions, 1);
			assertRecordContract(record, 'editor');
			assertRecordFields(record, [...COMMON_RECORD_FIELDS, 'action']);
		});

		test('counting a single replace increments only the replace-one counter', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.recordAction('replaceOne');

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.findActions, 0);
			assert.strictEqual(snapshot.replaceOneActions, 1);
			assert.strictEqual(snapshot.replaceAllActions, 0);

			const record = logger.singleRecordOf('action');
			assert.strictEqual(record.action, 'replaceOne');
			assert.strictEqual(record.replaceOneActions, 1);
		});

		test('counting a replace-all increments only the replace-all counter', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.recordAction('replaceAll');

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.findActions, 0);
			assert.strictEqual(snapshot.replaceOneActions, 0);
			assert.strictEqual(snapshot.replaceAllActions, 1);

			const record = logger.singleRecordOf('action');
			assert.strictEqual(record.action, 'replaceAll');
			assert.strictEqual(record.replaceAllActions, 1);
		});

		test('counting the same action repeatedly emits one record per call', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.recordAction('find');
			diagnostics.recordAction('find');
			diagnostics.recordAction('find');

			assert.strictEqual(diagnostics.getSnapshot().findActions, 3);

			const records = logger.recordsOf('action');
			assert.strictEqual(records.length, 3);
			assert.deepStrictEqual(records.map(record => record.findActions), [1, 2, 3]);
		});

		test('counting a mixed sequence keeps each counter independent', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.recordAction('find');
			diagnostics.recordAction('replaceOne');
			diagnostics.recordAction('find');
			diagnostics.recordAction('replaceAll');
			diagnostics.recordAction('replaceOne');

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.findActions, 2);
			assert.strictEqual(snapshot.replaceOneActions, 2);
			assert.strictEqual(snapshot.replaceAllActions, 1);

			const records = logger.recordsOf('action');
			assert.deepStrictEqual(
				records.map(record => record.action),
				['find', 'replaceOne', 'find', 'replaceAll', 'replaceOne']
			);
			assert.deepStrictEqual(records.map(record => record.findActions), [1, 1, 2, 2, 2]);
			assert.deepStrictEqual(records.map(record => record.replaceOneActions), [0, 1, 1, 1, 2]);
			assert.deepStrictEqual(records.map(record => record.replaceAllActions), [0, 0, 0, 1, 1]);
		});

		test('ignores actions counted before any session started', () => {
			const { logger, diagnostics } = create('editor');

			for (const action of RECORD_ACTIONS) {
				diagnostics.recordAction(action);
			}

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.findActions, 0);
			assert.strictEqual(snapshot.replaceOneActions, 0);
			assert.strictEqual(snapshot.replaceAllActions, 0);
			assert.strictEqual(snapshot.sessionActive, false);
			assert.strictEqual(logger.records.length, 0, 'no record was emitted');
		});

		test('ignores actions counted after the session ended', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.recordAction('find');
			diagnostics.endSession();
			const recordCount = logger.records.length;

			for (const action of RECORD_ACTIONS) {
				diagnostics.recordAction(action);
			}

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.findActions, 1, 'the completed count is untouched');
			assert.strictEqual(snapshot.replaceOneActions, 0);
			assert.strictEqual(snapshot.replaceAllActions, 0);
			assert.strictEqual(logger.records.length, recordCount, 'no extra record was emitted');
		});

		test('resets every counter when a new session starts', () => {
			const { diagnostics } = create('editor');

			diagnostics.startSession();
			for (const action of RECORD_ACTIONS) {
				diagnostics.recordAction(action);
			}
			diagnostics.endSession();

			diagnostics.startSession();

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.findActions, 0);
			assert.strictEqual(snapshot.replaceOneActions, 0);
			assert.strictEqual(snapshot.replaceAllActions, 0);
		});

		test('counts every action for a notebook widget', () => {
			const { logger, diagnostics } = create('notebook');

			diagnostics.startSession();
			for (const action of RECORD_ACTIONS) {
				diagnostics.recordAction(action);
			}

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.findActions, 1);
			assert.strictEqual(snapshot.replaceOneActions, 1);
			assert.strictEqual(snapshot.replaceAllActions, 1);

			const records = logger.recordsOf('action');
			assert.deepStrictEqual(records.map(record => record.action), [...RECORD_ACTIONS]);
			for (const record of records) {
				assertRecordContract(record, 'notebook');
			}
		});
	});

	suite('readiness and health records', () => {

		test('emits one health record for each readiness value that changes during a session', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();

			diagnostics.updateSnapshot({ controlsReady: true });
			assert.strictEqual(diagnostics.getSnapshot().controlsReady, true);
			assert.strictEqual(logger.recordsOf('health').length, 1);

			diagnostics.updateSnapshot({ stateWired: true });
			assert.strictEqual(diagnostics.getSnapshot().stateWired, true);
			assert.strictEqual(logger.recordsOf('health').length, 2);

			for (const record of logger.recordsOf('health')) {
				assertRecordContract(record, 'editor');
				assertRecordFields(record, COMMON_RECORD_FIELDS);
			}
		});

		test('emits at most one health record when a single call changes both readiness values', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.updateSnapshot({ controlsReady: true, stateWired: true });

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.controlsReady, true);
			assert.strictEqual(snapshot.stateWired, true);

			const record = logger.singleRecordOf('health');
			assert.strictEqual(record.controlsReady, true);
			assert.strictEqual(record.stateWired, true);
		});

		test('emits no health record when a readiness value is rewritten unchanged', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.updateSnapshot({ controlsReady: true, stateWired: true });
			assert.strictEqual(logger.recordsOf('health').length, 1);

			diagnostics.updateSnapshot({ controlsReady: true, stateWired: true });
			diagnostics.updateSnapshot({ controlsReady: true });
			diagnostics.updateSnapshot({ stateWired: true });
			diagnostics.updateSnapshot({});

			assert.strictEqual(logger.recordsOf('health').length, 1, 'no repeat health record');
		});

		test('emits no record for a visibility or match-count update', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.updateSnapshot({ controlsReady: true, stateWired: true });
			const recordCount = logger.records.length;

			diagnostics.updateSnapshot({ visible: true });
			diagnostics.updateSnapshot({ replaceVisible: true });
			diagnostics.updateSnapshot({ matchesCount: 12 });
			diagnostics.updateSnapshot({ visible: false, replaceVisible: false, matchesCount: 0 });

			assert.strictEqual(logger.records.length, recordCount, 'no record was emitted');

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.visible, false);
			assert.strictEqual(snapshot.replaceVisible, false);
			assert.strictEqual(snapshot.matchesCount, 0);
			assert.strictEqual(
				snapshot.controlsReady && snapshot.stateWired,
				true,
				'readiness is unaffected by a hidden widget'
			);
		});

		test('applies a readiness change made while no session is active without emitting a record', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.updateSnapshot({ controlsReady: true, stateWired: true });

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.controlsReady, true);
			assert.strictEqual(snapshot.stateWired, true);
			assert.strictEqual(snapshot.sessionActive, false);
			assert.strictEqual(logger.records.length, 0, 'no record was emitted');
		});

		test('carries the readiness a host wired before the session into the sessionStart record', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.updateSnapshot({ controlsReady: true, stateWired: true, visible: true, matchesCount: 5 });
			diagnostics.startSession();

			const record = logger.singleRecordOf('sessionStart');
			assert.strictEqual(record.controlsReady, true);
			assert.strictEqual(record.stateWired, true);
			assert.strictEqual(record.visible, true);
			assert.strictEqual(record.replaceVisible, false);
			assert.strictEqual(record.matchesCount, 5);
			assert.strictEqual(logger.recordsOf('health').length, 0, 'no health record was emitted');
		});

		test('reports a readiness regression during a session as one health record', () => {
			const { logger, diagnostics } = create('notebook');

			diagnostics.updateSnapshot({ controlsReady: true, stateWired: true });
			diagnostics.startSession();
			diagnostics.updateSnapshot({ controlsReady: false });

			const record = logger.singleRecordOf('health');
			assert.strictEqual(record.controlsReady, false);
			assert.strictEqual(record.stateWired, true);
			assertRecordContract(record, 'notebook');
			assert.strictEqual(diagnostics.getSnapshot().controlsReady, false);
		});
	});


	suite('record schema and privacy', () => {

		/** Drives one complete session that exercises every kind of record. */
		function driveFullSession(diagnostics: FindReplaceWidgetDiagnostics): void {
			diagnostics.updateSnapshot({ controlsReady: true, stateWired: true });
			diagnostics.startSession();
			diagnostics.updateSnapshot({ visible: true, replaceVisible: true, matchesCount: 7 });
			diagnostics.updateSnapshot({ controlsReady: false });
			diagnostics.recordAction('find');
			diagnostics.recordAction('replaceOne');
			diagnostics.recordAction('replaceAll');
			diagnostics.endSession();
		}

		test('every record of every host is tagged, correlated and free of sensitive fields', () => {
			for (const host of RECORD_HOSTS) {
				const { logger, diagnostics } = create(host);

				driveFullSession(diagnostics);

				assert.strictEqual(logger.records.length, 6, `record count for the ${host} host`);
				assert.deepStrictEqual(
					logger.records.map(record => record.event),
					['sessionStart', 'health', 'action', 'action', 'action', 'sessionEnd'],
					`record events for the ${host} host`
				);

				for (const record of logger.records) {
					assertRecordContract(record, host);
				}
			}
		});

		test('every record shares the correlation id of the session that produced it', () => {
			const { logger, diagnostics } = create('editor');

			driveFullSession(diagnostics);

			const correlationId = diagnostics.getSnapshot().correlationId;
			assert.ok(isUUID(correlationId), `correlation id: ${correlationId}`);
			for (const record of logger.records) {
				assert.strictEqual(record.correlationId, correlationId, `${record.event} record correlation id`);
			}
		});

		test('records of a second session carry the rotated correlation id', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.recordAction('find');
			diagnostics.endSession();
			const firstCorrelationId = diagnostics.getSnapshot().correlationId;
			const firstSessionRecordCount = logger.records.length;

			diagnostics.startSession();
			diagnostics.recordAction('find');
			diagnostics.endSession();
			const secondCorrelationId = diagnostics.getSnapshot().correlationId;

			assert.notStrictEqual(secondCorrelationId, firstCorrelationId);
			for (const record of logger.records.slice(0, firstSessionRecordCount)) {
				assert.strictEqual(record.correlationId, firstCorrelationId);
			}
			for (const record of logger.records.slice(firstSessionRecordCount)) {
				assert.strictEqual(record.correlationId, secondCorrelationId);
			}
		});

		test('every record carries the complete snapshot field set', () => {
			const { logger, diagnostics } = create('editor');

			driveFullSession(diagnostics);

			for (const record of logger.records) {
				const fields = Object.keys(record);
				for (const snapshotField of SNAPSHOT_FIELDS) {
					assert.ok(fields.includes(snapshotField), `${record.event} record carries ${snapshotField}`);
				}
			}
		});

		test('only action records carry an action and only sessionEnd records carry a duration', () => {
			const { logger, diagnostics } = create('editor');

			driveFullSession(diagnostics);

			for (const record of logger.records) {
				const fields = Object.keys(record);
				assert.strictEqual(
					fields.includes('action'),
					record.event === 'action',
					`action field on the ${record.event} record`
				);
				assert.strictEqual(
					fields.includes('durationMs'),
					record.event === 'sessionEnd',
					`durationMs field on the ${record.event} record`
				);
			}
		});

		test('accompanies every record with a non-empty message', () => {
			const { logger, diagnostics } = create('editor');

			driveFullSession(diagnostics);

			assert.strictEqual(logger.messages.length, logger.records.length, 'one message per record');
			for (const message of logger.messages) {
				assert.strictEqual(typeof message, 'string');
				assert.ok(message.length > 0, 'the record message is not empty');
			}
		});

		test('writes every signal at trace level and produces no other output', () => {
			const { logger, diagnostics } = create('editor');

			driveFullSession(diagnostics);

			assert.ok(logger.records.length > 0, 'trace records were emitted');
			assert.deepStrictEqual(logger.messagesAboveTrace, [], 'nothing was written above trace level');
		});

		test('keeps the counters and state readable as a metrics surface after the session', () => {
			const { diagnostics } = create('editor');

			driveFullSession(diagnostics);

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.findActions, 1);
			assert.strictEqual(snapshot.replaceOneActions, 1);
			assert.strictEqual(snapshot.replaceAllActions, 1);
			assert.strictEqual(snapshot.matchesCount, 7);
			assert.strictEqual(snapshot.controlsReady, false);
			assert.strictEqual(snapshot.stateWired, true);
			assert.strictEqual(snapshot.visible, true);
			assert.strictEqual(snapshot.replaceVisible, true);
			assertMeasuredDuration(snapshot.lastSessionDurationMs, 'lastSessionDurationMs');
		});
	});

	suite('disposal', () => {

		test('ends an active session and emits its sessionEnd record', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.recordAction('find');
			diagnostics.dispose();

			const record = logger.singleRecordOf('sessionEnd');
			assertRecordContract(record, 'editor');
			assertMeasuredDuration(record.durationMs, 'sessionEnd durationMs');

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.sessionActive, false);
			assert.strictEqual(snapshot.findActions, 1, 'the completed count stays readable');
			assert.strictEqual(record.durationMs, snapshot.lastSessionDurationMs);
		});

		test('emits no record when disposed without an active session', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.updateSnapshot({ controlsReady: true, stateWired: true });
			diagnostics.dispose();

			assert.strictEqual(logger.records.length, 0, 'no record was emitted');
			assert.strictEqual(diagnostics.getSnapshot().sessionActive, false);
		});

		test('emits no record when disposed after the session already ended', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.endSession();
			const recordCount = logger.records.length;

			diagnostics.dispose();

			assert.strictEqual(logger.records.length, recordCount, 'no extra record was emitted');
			assert.strictEqual(logger.recordsOf('sessionEnd').length, 1, 'exactly one sessionEnd record');
		});

		test('is safe to dispose twice', () => {
			const { logger, diagnostics } = create('notebook');

			diagnostics.startSession();
			diagnostics.dispose();
			const afterFirstDispose = diagnostics.getSnapshot();
			const recordCount = logger.records.length;

			diagnostics.dispose();

			assert.deepStrictEqual(diagnostics.getSnapshot(), afterFirstDispose, 'nothing observable changed');
			assert.strictEqual(logger.records.length, recordCount, 'no duplicate record was emitted');
			assert.strictEqual(logger.recordsOf('sessionEnd').length, 1, 'exactly one sessionEnd record');
		});

		test('counts no further action once disposal ended the session', () => {
			const { logger, diagnostics } = create('editor');

			diagnostics.startSession();
			diagnostics.recordAction('find');
			diagnostics.dispose();
			const recordCount = logger.records.length;

			for (const action of RECORD_ACTIONS) {
				diagnostics.recordAction(action);
			}
			diagnostics.endSession();

			const snapshot = diagnostics.getSnapshot();
			assert.strictEqual(snapshot.sessionActive, false);
			assert.strictEqual(snapshot.findActions, 1, 'the completed count is untouched');
			assert.strictEqual(snapshot.replaceOneActions, 0);
			assert.strictEqual(snapshot.replaceAllActions, 0);
			assert.strictEqual(logger.records.length, recordCount, 'no extra record was emitted');
		});
	});
});

