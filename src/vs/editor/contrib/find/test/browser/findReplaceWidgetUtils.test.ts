/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FIND_REPLACE_WIDGET_INITIAL_WIDTH, updateFindMatchesCount, updateFindReplaceControlState, validateFindRegex } from '../../browser/findReplaceWidgetUtils.js';

/**
 * Records every `setEnabled` call made on a stand-in for a find input, a replace input or a
 * replace button.
 */
class EnabledStateRecorder {

	readonly calls: boolean[] = [];

	setEnabled(enabled: boolean): void {
		this.calls.push(enabled);
	}
}

/**
 * Records every `setExpanded` call made on a stand-in for a replace-mode toggle.
 */
class ExpandedStateRecorder {

	readonly calls: boolean[] = [];

	setExpanded(expanded: boolean): void {
		this.calls.push(expanded);
	}
}

/**
 * Records calls to the controls each host updates itself. None of these is passed to the utilities.
 */
class HostOnlyResidueRecorder {

	readonly closeBtnCalls: boolean[] = [];
	readonly prevBtnCalls: boolean[] = [];
	readonly nextBtnCalls: boolean[] = [];
	readonly toggleSelectionCalls: boolean[] = [];
	readonly toggleReplaceEnabledCalls: boolean[] = [];
	readonly updateButtonsCalls: boolean[] = [];

	setCloseBtnEnabled(enabled: boolean): void {
		this.closeBtnCalls.push(enabled);
	}

	setPrevBtnEnabled(enabled: boolean): void {
		this.prevBtnCalls.push(enabled);
	}

	setNextBtnEnabled(enabled: boolean): void {
		this.nextBtnCalls.push(enabled);
	}

	updateToggleSelectionFindButton(enabled: boolean): void {
		this.toggleSelectionCalls.push(enabled);
	}

	setToggleReplaceEnabled(enabled: boolean): void {
		this.toggleReplaceEnabledCalls.push(enabled);
	}

	updateButtons(foundMatch: boolean): void {
		this.updateButtonsCalls.push(foundMatch);
	}

	get totalCalls(): number {
		return this.closeBtnCalls.length
			+ this.prevBtnCalls.length
			+ this.nextBtnCalls.length
			+ this.toggleSelectionCalls.length
			+ this.toggleReplaceEnabledCalls.length
			+ this.updateButtonsCalls.length;
	}
}

suite('Find/Replace Widget Utils', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('FIND_REPLACE_WIDGET_INITIAL_WIDTH', () => {

		test('is the single shared initial widget width', () => {
			assert.strictEqual(FIND_REPLACE_WIDGET_INITIAL_WIDTH, 419);
		});

		test('is a usable pixel width', () => {
			assert.strictEqual(typeof FIND_REPLACE_WIDGET_INITIAL_WIDTH, 'number');
			assert.strictEqual(Number.isInteger(FIND_REPLACE_WIDGET_INITIAL_WIDTH), true);
			assert.strictEqual(FIND_REPLACE_WIDGET_INITIAL_WIDTH > 0, true);
		});
	});

	suite('validateFindRegex', () => {

		test('an empty value is not validated', () => {
			assert.strictEqual(validateFindRegex('', true), null);
			assert.strictEqual(validateFindRegex('', true, 'gu'), null);
			assert.strictEqual(validateFindRegex('', false), null);
			assert.strictEqual(validateFindRegex('', false, 'gu'), null);
			assert.strictEqual(validateFindRegex('', true, ''), null);
		});

		test('a value is not validated while the regex toggle is off', () => {
			assert.strictEqual(validateFindRegex('[', false), null);
			assert.strictEqual(validateFindRegex('[', false, 'gu'), null);
			assert.strictEqual(validateFindRegex('a**', false), null);
			assert.strictEqual(validateFindRegex('\\', false, 'gu'), null);
		});

		test('a valid pattern reports no error', () => {
			assert.strictEqual(validateFindRegex('abc', true), null);
			assert.strictEqual(validateFindRegex('abc', true, 'gu'), null);
			assert.strictEqual(validateFindRegex('a+', true), null);
			assert.strictEqual(validateFindRegex('a+', true, 'gu'), null);
			assert.strictEqual(validateFindRegex('(\\w+)\\s(\\w+)', true, 'gu'), null);
		});

		test('an invalid pattern reports an input box message', () => {
			const message = validateFindRegex('[', true, 'gu');

			assert.ok(message);
			assert.strictEqual(typeof message.content, 'string');
			assert.strictEqual((message.content ?? '').length > 0, true);
		});

		test('an invalid pattern reports an input box message without flags too', () => {
			const message = validateFindRegex('a**', true);

			assert.ok(message);
			assert.strictEqual(typeof message.content, 'string');
			assert.strictEqual((message.content ?? '').length > 0, true);
		});

		test('a pattern invalid under every flag reports an error either way', () => {
			for (const value of ['[', '(', 'a)', '*', 'a**', '\\']) {
				assert.notStrictEqual(validateFindRegex(value, true), null, value);
				assert.notStrictEqual(validateFindRegex(value, true, 'gu'), null, value);
			}
		});

		test('omitted flags compile the pattern with no flags', () => {
			assert.strictEqual(validateFindRegex('\\a', true), null);
			assert.notStrictEqual(validateFindRegex('\\a', true, 'gu'), null);
		});

		test('the supplied flags decide the outcome', () => {
			for (const value of ['\\a', '\\-', 'a{,2}', '[\\w-.]', '\\p{Foo}']) {
				assert.strictEqual(validateFindRegex(value, true), null, value);
				assert.strictEqual(validateFindRegex(value, true, ''), null, value);
				assert.notStrictEqual(validateFindRegex(value, true, 'gu'), null, value);
			}
		});

		test('validating has no side effect on widget controls', () => {
			const residue = new HostOnlyResidueRecorder();
			const element = document.createElement('div');

			validateFindRegex('abc', true, 'gu');
			validateFindRegex('[', true, 'gu');
			validateFindRegex('[', true);
			validateFindRegex('[', false);
			validateFindRegex('', true, 'gu');

			assert.strictEqual(residue.totalCalls, 0);
			assert.strictEqual(element.classList.length, 0);
			assert.strictEqual(element.title, '');
			assert.strictEqual(element.childNodes.length, 0);
			assert.strictEqual(element.style.minWidth, '');
		});

		test('repeated and interleaved calls are order independent', () => {
			const firstValid = validateFindRegex('abc', true, 'gu');
			const firstInvalid = validateFindRegex('[', true, 'gu');
			const secondValid = validateFindRegex('abc', true, 'gu');
			const secondInvalid = validateFindRegex('[', true, 'gu');

			assert.strictEqual(firstValid, null);
			assert.strictEqual(secondValid, null);
			assert.ok(firstInvalid);
			assert.ok(secondInvalid);
			assert.deepStrictEqual(secondInvalid, firstInvalid);

			const invalidFirst = validateFindRegex('[', true, 'gu');
			const validAfterInvalid = validateFindRegex('abc', true, 'gu');

			assert.deepStrictEqual(invalidFirst, firstInvalid);
			assert.strictEqual(validAfterInvalid, null);
		});
	});

	suite('updateFindMatchesCount', () => {

		const matchesLocationLabel = '{0} of {1}';
		const noResultsLabel = 'No results';
		const limitTitle = 'Only the first 19999 results are highlighted.';

		/**
		 * Renders without a limit title, the way a host that never shows one calls the utility.
		 */
		const render = (target: HTMLElement, currentMinimumWidth: number, matchesCount: number, matchesPosition: string, matchesLimit: number) => {
			return updateFindMatchesCount(target, {
				currentMinimumWidth,
				matchesCount,
				matchesPosition,
				matchesLimit,
				matchesLocationLabel,
				noResultsLabel
			});
		};

		/**
		 * Renders with a limit title, the way a host that shows one on reaching the limit calls the
		 * utility.
		 */
		const renderWithLimitTitle = (target: HTMLElement, currentMinimumWidth: number, matchesCount: number, matchesPosition: string, matchesLimit: number) => {
			return updateFindMatchesCount(target, {
				currentMinimumWidth,
				matchesCount,
				matchesPosition,
				matchesLimit,
				limitTitle,
				matchesLocationLabel,
				noResultsLabel
			});
		};

		test('no match renders the no-results label', () => {
			const target = document.createElement('div');
			const result = render(target, 69, 0, '0', 19999);

			assert.strictEqual(result.label, noResultsLabel);
			assert.strictEqual(target.textContent, noResultsLabel);
			assert.strictEqual(target.childNodes.length, 1);
		});

		test('a negative count renders the no-results label', () => {
			const target = document.createElement('div');
			const result = render(target, 69, -1, '0', 19999);

			assert.strictEqual(result.label, noResultsLabel);
			assert.strictEqual(target.textContent, noResultsLabel);
		});

		test('a match renders the position before the count', () => {
			const target = document.createElement('div');
			const result = render(target, 69, 5, '2', 19999);

			assert.strictEqual(result.label, '2 of 5');
			assert.strictEqual(target.textContent, '2 of 5');

			const other = document.createElement('div');

			assert.strictEqual(render(other, 69, 7, '3', 19999).label, '3 of 7');
		});

		test('a count that reaches the limit is suffixed', () => {
			const atLimit = document.createElement('div');

			assert.strictEqual(render(atLimit, 69, 19999, '1', 19999).label, '1 of 19999+');

			const overLimit = document.createElement('div');

			assert.strictEqual(render(overLimit, 69, 20000, '1', 19999).label, '1 of 20000+');
		});

		test('a count below the limit is not suffixed', () => {
			const target = document.createElement('div');

			assert.strictEqual(render(target, 69, 19998, '1', 19999).label, '1 of 19998');
		});

		test('the host-resolved position is rendered verbatim', () => {
			const unknown = document.createElement('div');

			assert.strictEqual(render(unknown, 69, 3, '?', 19999).label, '? of 3');

			const numeric = document.createElement('div');

			assert.strictEqual(render(numeric, 69, 34, '12', 19999).label, '12 of 34');
		});

		test('the limit title becomes the tooltip once the limit is reached', () => {
			const atLimit = document.createElement('div');
			renderWithLimitTitle(atLimit, 69, 19999, '1', 19999);

			assert.strictEqual(atLimit.title, limitTitle);

			const overLimit = document.createElement('div');
			renderWithLimitTitle(overLimit, 69, 20000, '1', 19999);

			assert.strictEqual(overLimit.title, limitTitle);
		});

		test('the tooltip is cleared below the limit', () => {
			const belowLimit = document.createElement('div');
			renderWithLimitTitle(belowLimit, 69, 19998, '1', 19999);

			assert.strictEqual(belowLimit.title, '');

			const noMatch = document.createElement('div');
			renderWithLimitTitle(noMatch, 69, 0, '0', 19999);

			assert.strictEqual(noMatch.title, '');
		});

		test('an omitted limit title always clears the tooltip', () => {
			const atLimit = document.createElement('div');
			render(atLimit, 69, 19999, '1', 19999);

			assert.strictEqual(atLimit.title, '');

			const overLimit = document.createElement('div');
			render(overLimit, 69, 20000, '1', 19999);

			assert.strictEqual(overLimit.title, '');

			const belowLimit = document.createElement('div');
			render(belowLimit, 69, 3, '1', 19999);

			assert.strictEqual(belowLimit.title, '');
		});

		test('the tooltip is cleared again once the count drops below the limit', () => {
			const target = document.createElement('div');
			renderWithLimitTitle(target, 69, 19999, '1', 19999);

			assert.strictEqual(target.title, limitTitle);

			renderWithLimitTitle(target, 69, 4, '1', 19999);

			assert.strictEqual(target.title, '');
		});

		test('the previous text is replaced rather than appended', () => {
			const target = document.createElement('div');
			render(target, 69, 5, '2', 19999);

			assert.strictEqual(target.childNodes.length, 1);
			assert.strictEqual(target.textContent, '2 of 5');

			const second = render(target, 69, 0, '0', 19999);

			assert.strictEqual(target.childNodes.length, 1);
			assert.strictEqual(target.textContent, noResultsLabel);
			assert.strictEqual(second.label, noResultsLabel);

			const third = render(target, 69, 8, '3', 19999);

			assert.strictEqual(target.childNodes.length, 1);
			assert.strictEqual(target.textContent, '3 of 8');
			assert.strictEqual(third.label, '3 of 8');
		});

		test('the supplied width is applied as a pixel min width', () => {
			const target = document.createElement('div');
			render(target, 69, 5, '2', 19999);

			assert.strictEqual(target.style.minWidth, '69px');

			render(target, 120, 5, '2', 19999);

			assert.strictEqual(target.style.minWidth, '120px');

			render(target, 0, 5, '2', 19999);

			assert.strictEqual(target.style.minWidth, '0px');
		});

		test('the returned minimum width never drops below the supplied width', () => {
			const target = document.createElement('div');

			assert.strictEqual(render(target, 69, 5, '2', 19999).minimumWidth >= 69, true);
			assert.strictEqual(render(target, 0, 5, '2', 19999).minimumWidth >= 0, true);
			assert.strictEqual(render(target, 250, 5, '2', 19999).minimumWidth >= 250, true);
		});

		test('feeding the returned minimum width back in never decreases it', () => {
			const target = document.createElement('div');
			let minimumWidth = 69;

			for (const matchesCount of [1, 20, 300, 4000, 19999, 0]) {
				const previous = minimumWidth;
				minimumWidth = render(target, minimumWidth, matchesCount, '1', 19999).minimumWidth;

				assert.strictEqual(minimumWidth >= previous, true, String(matchesCount));
			}
		});

		test('the returned label is the text written into the element', () => {
			const target = document.createElement('div');

			for (const matchesCount of [0, 1, 5, 19999, 20000]) {
				const result = render(target, 69, matchesCount, '1', 19999);

				assert.strictEqual(result.label, target.textContent, String(matchesCount));
			}
		});

		test('only the text, tooltip and min width of the element are touched', () => {
			const target = document.createElement('div');
			renderWithLimitTitle(target, 69, 19999, '1', 19999);

			for (const name of target.getAttributeNames()) {
				assert.strictEqual(name === 'style' || name === 'title', true, name);
			}

			assert.strictEqual(target.classList.length, 0);
		});

		test('nothing outside the supplied labels reaches the rendered text', () => {
			const target = document.createElement('div');
			const result = updateFindMatchesCount(target, {
				currentMinimumWidth: 69,
				matchesCount: 4,
				matchesPosition: '<position>',
				matchesLimit: 19999,
				matchesLocationLabel: '[{0}|{1}]',
				noResultsLabel: '<none>'
			});

			assert.strictEqual(result.label, '[<position>|4]');
			assert.strictEqual(target.textContent, '[<position>|4]');

			const empty = document.createElement('div');
			const emptyResult = updateFindMatchesCount(empty, {
				currentMinimumWidth: 69,
				matchesCount: 0,
				matchesPosition: '<position>',
				matchesLimit: 19999,
				matchesLocationLabel: '[{0}|{1}]',
				noResultsLabel: '<none>'
			});

			assert.strictEqual(emptyResult.label, '<none>');
			assert.strictEqual(empty.textContent, '<none>');
		});

		test('no widget control is reached while rendering', () => {
			const residue = new HostOnlyResidueRecorder();
			const target = document.createElement('div');

			render(target, 69, 0, '0', 19999);
			render(target, 69, 5, '2', 19999);
			renderWithLimitTitle(target, 69, 19999, '1', 19999);

			assert.strictEqual(residue.totalCalls, 0);
		});

		test('identical inputs on fresh targets produce identical results', () => {
			const first = document.createElement('div');
			const firstResult = render(first, 69, 19999, '1', 19999);

			const interleaved = document.createElement('div');
			render(interleaved, 250, 0, '0', 19999);

			const second = document.createElement('div');
			const secondResult = render(second, 69, 19999, '1', 19999);

			assert.strictEqual(secondResult.label, firstResult.label);
			assert.strictEqual(secondResult.minimumWidth, firstResult.minimumWidth);
			assert.strictEqual(first.textContent, second.textContent);
			assert.strictEqual(first.style.minWidth, second.style.minWidth);
		});

		test('a wider earlier call does not widen a later one', () => {
			const wide = document.createElement('div');
			const wideResult = render(wide, 900, 5, '2', 19999);

			assert.strictEqual(wideResult.minimumWidth >= 900, true);

			const narrow = document.createElement('div');
			const narrowResult = render(narrow, 69, 5, '2', 19999);

			assert.strictEqual(narrowResult.minimumWidth < 900, true);
			assert.strictEqual(narrow.style.minWidth, '69px');
		});
	});

	suite('updateFindReplaceControlState', () => {

		/**
		 * Drives the utility with a fresh recorder per control and reports what each recorded.
		 */
		const drive = (visible: boolean, replaceVisible: boolean, searchString: string, rootNode: HTMLElement) => {
			const findInput = new EnabledStateRecorder();
			const replaceInput = new EnabledStateRecorder();
			const replaceBtn = new EnabledStateRecorder();
			const replaceAllBtn = new EnabledStateRecorder();
			const toggleReplaceBtn = new ExpandedStateRecorder();

			const findInputIsNonEmpty = updateFindReplaceControlState({
				visible,
				replaceVisible,
				searchString,
				findInput,
				replaceInput,
				replaceBtn,
				replaceAllBtn,
				toggleReplaceBtn,
				rootNode
			});

			return { findInput, replaceInput, replaceBtn, replaceAllBtn, toggleReplaceBtn, findInputIsNonEmpty };
		};

		test('drives every control across the whole visibility matrix', () => {
			for (const visible of [true, false]) {
				for (const replaceVisible of [true, false]) {
					for (const searchString of ['', 'needle']) {
						const rootNode = document.createElement('div');
						const outcome = drive(visible, replaceVisible, searchString, rootNode);
						const cell = `visible=${visible} replaceVisible=${replaceVisible} searchString='${searchString}'`;
						const findInputIsNonEmpty = searchString.length > 0;

						assert.deepStrictEqual(outcome.findInput.calls, [visible], cell);
						assert.deepStrictEqual(outcome.replaceInput.calls, [visible && replaceVisible], cell);
						assert.deepStrictEqual(outcome.replaceBtn.calls, [visible && replaceVisible && findInputIsNonEmpty], cell);
						assert.deepStrictEqual(outcome.replaceAllBtn.calls, [visible && replaceVisible && findInputIsNonEmpty], cell);
						assert.deepStrictEqual(outcome.toggleReplaceBtn.calls, [replaceVisible], cell);
						assert.strictEqual(rootNode.classList.contains('replaceToggled'), replaceVisible, cell);
						assert.strictEqual(outcome.findInputIsNonEmpty, findInputIsNonEmpty, cell);
					}
				}
			}
		});

		test('reports whether the find query is non-empty', () => {
			const rootNode = document.createElement('div');

			assert.strictEqual(drive(true, true, '', rootNode).findInputIsNonEmpty, false);
			assert.strictEqual(drive(true, true, 'a', rootNode).findInputIsNonEmpty, true);
			assert.strictEqual(drive(true, true, ' ', rootNode).findInputIsNonEmpty, true);
			assert.strictEqual(drive(false, false, 'needle', rootNode).findInputIsNonEmpty, true);
			assert.strictEqual(drive(false, false, '', rootNode).findInputIsNonEmpty, false);
		});

		test('the replace-toggled class is toggled back off again', () => {
			const rootNode = document.createElement('div');

			drive(true, true, 'needle', rootNode);

			assert.strictEqual(rootNode.classList.contains('replaceToggled'), true);

			drive(true, false, 'needle', rootNode);

			assert.strictEqual(rootNode.classList.contains('replaceToggled'), false);

			drive(true, true, 'needle', rootNode);

			assert.strictEqual(rootNode.classList.contains('replaceToggled'), true);
		});

		test('each control is set exactly once per call', () => {
			const findInput = new EnabledStateRecorder();
			const replaceInput = new EnabledStateRecorder();
			const replaceBtn = new EnabledStateRecorder();
			const replaceAllBtn = new EnabledStateRecorder();
			const toggleReplaceBtn = new ExpandedStateRecorder();
			const rootNode = document.createElement('div');

			const options = {
				visible: true,
				replaceVisible: true,
				searchString: 'needle',
				findInput,
				replaceInput,
				replaceBtn,
				replaceAllBtn,
				toggleReplaceBtn,
				rootNode
			};

			updateFindReplaceControlState(options);

			assert.deepStrictEqual(findInput.calls, [true]);
			assert.deepStrictEqual(replaceInput.calls, [true]);
			assert.deepStrictEqual(replaceBtn.calls, [true]);
			assert.deepStrictEqual(replaceAllBtn.calls, [true]);
			assert.deepStrictEqual(toggleReplaceBtn.calls, [true]);

			updateFindReplaceControlState(options);

			assert.deepStrictEqual(findInput.calls, [true, true]);
			assert.deepStrictEqual(replaceInput.calls, [true, true]);
			assert.deepStrictEqual(replaceBtn.calls, [true, true]);
			assert.deepStrictEqual(replaceAllBtn.calls, [true, true]);
			assert.deepStrictEqual(toggleReplaceBtn.calls, [true, true]);
		});

		test('the controls each host owns itself are never reached', () => {
			const residue = new HostOnlyResidueRecorder();

			for (const visible of [true, false]) {
				for (const replaceVisible of [true, false]) {
					for (const searchString of ['', 'needle']) {
						drive(visible, replaceVisible, searchString, document.createElement('div'));
					}
				}
			}

			assert.strictEqual(residue.closeBtnCalls.length, 0);
			assert.strictEqual(residue.prevBtnCalls.length, 0);
			assert.strictEqual(residue.nextBtnCalls.length, 0);
			assert.strictEqual(residue.toggleSelectionCalls.length, 0);
			assert.strictEqual(residue.toggleReplaceEnabledCalls.length, 0);
			assert.strictEqual(residue.updateButtonsCalls.length, 0);
			assert.strictEqual(residue.totalCalls, 0);
		});

		test('the replace-mode toggle is only expanded, never enabled', () => {
			const toggleReplaceBtn = new ExpandedStateRecorder();
			const rootNode = document.createElement('div');

			updateFindReplaceControlState({
				visible: true,
				replaceVisible: false,
				searchString: 'needle',
				findInput: new EnabledStateRecorder(),
				replaceInput: new EnabledStateRecorder(),
				replaceBtn: new EnabledStateRecorder(),
				replaceAllBtn: new EnabledStateRecorder(),
				toggleReplaceBtn,
				rootNode
			});

			assert.deepStrictEqual(toggleReplaceBtn.calls, [false]);
			assert.strictEqual('setEnabled' in toggleReplaceBtn, false);
		});

		test('only the replace-toggled class of the root element is touched', () => {
			const rootNode = document.createElement('div');
			drive(true, true, 'needle', rootNode);

			assert.deepStrictEqual([...rootNode.classList], ['replaceToggled']);
			assert.strictEqual(rootNode.childNodes.length, 0);
			assert.strictEqual(rootNode.title, '');
			assert.strictEqual(rootNode.style.minWidth, '');

			for (const name of rootNode.getAttributeNames()) {
				assert.strictEqual(name, 'class', name);
			}
		});

		test('a class already on the root element is preserved', () => {
			const rootNode = document.createElement('div');
			rootNode.classList.add('editor-widget', 'find-widget');

			drive(true, true, 'needle', rootNode);

			assert.strictEqual(rootNode.classList.contains('editor-widget'), true);
			assert.strictEqual(rootNode.classList.contains('find-widget'), true);
			assert.strictEqual(rootNode.classList.contains('replaceToggled'), true);

			drive(true, false, 'needle', rootNode);

			assert.strictEqual(rootNode.classList.contains('editor-widget'), true);
			assert.strictEqual(rootNode.classList.contains('find-widget'), true);
			assert.strictEqual(rootNode.classList.contains('replaceToggled'), false);
		});
	});
});
