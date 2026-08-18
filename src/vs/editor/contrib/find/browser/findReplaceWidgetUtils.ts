/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMessage } from '../../../../base/browser/ui/inputbox/inputBox.js';
import * as strings from '../../../../base/common/strings.js';

/**
 * The initial width, in pixels, of an in-place find/replace widget.
 *
 * It is the width the widget is laid out with before the user drags its resize handle, and the
 * width it returns to when a resize is reset.
 */
export const FIND_REPLACE_WIDGET_INITIAL_WIDTH = 419;

/**
 * Validates that the text entered in a find input is a well-formed regular expression.
 *
 * The value is not validated - and `null` is returned - when it is empty or when the find input's
 * regular-expression toggle is off. A value entered with that toggle off is matched as literal
 * text and is never compiled as a pattern.
 *
 * The check has no side effect: it compiles the pattern, discards it and reports the outcome. A
 * caller that must react to an invalid pattern beyond showing the message does so itself.
 *
 * @param value The raw text currently entered in the find input.
 * @param regexEnabled Whether the find input's regular-expression toggle is on.
 * @param flags The flags to compile the pattern with. Omit them to compile the pattern with no
 * flags. Passing `'gu'` compiles it with the global and unicode semantics the `TextModel` search
 * applies, which makes a pattern that is invalid under those flags - such as an unsupported
 * unicode escape - report an error here too.
 * @returns `null` when the value is not validated or compiles successfully, otherwise an
 * {@link IMessage} whose `content` is the message reported by the regular-expression engine, in
 * the shape an input box renders as a validation error.
 */
export function validateFindRegex(value: string, regexEnabled: boolean, flags?: string): IMessage | null {
	if (value.length === 0 || !regexEnabled) {
		return null;
	}

	try {
		if (flags === undefined) {
			new RegExp(value);
		} else {
			new RegExp(value, flags);
		}
		return null;
	} catch (e) {
		return { content: e.message };
	}
}

/**
 * The counts, labels and measurement consumed by {@link updateFindMatchesCount}.
 */
export interface IFindMatchesCountOptions {
	/**
	 * The width, in pixels, currently reserved for the match-count element. It is applied to the
	 * element as its `min-width` and is the lower bound of the returned minimum width.
	 */
	readonly currentMinimumWidth: number;

	/**
	 * The number of matches found. A value of `0` or less renders `noResultsLabel`.
	 */
	readonly matchesCount: number;

	/**
	 * The ordinal of the current match, already resolved and formatted by the caller. It fills the
	 * `{0}` placeholder of `matchesLocationLabel`.
	 */
	readonly matchesPosition: string;

	/**
	 * The number of matches at which counting is capped. When `matchesCount` reaches it, the
	 * rendered count is suffixed with `'+'` and `limitTitle`, if supplied, becomes the element's
	 * tooltip.
	 */
	readonly matchesLimit: number;

	/**
	 * The tooltip to apply while `matchesCount` has reached `matchesLimit`. When it is omitted the
	 * element's tooltip is always cleared, whatever the count.
	 */
	readonly limitTitle?: string;

	/**
	 * The already-localized template rendered when there is at least one match. Its `{0}`
	 * placeholder receives `matchesPosition` and its `{1}` placeholder receives the count.
	 */
	readonly matchesLocationLabel: string;

	/**
	 * The already-localized text rendered verbatim when there is no match.
	 */
	readonly noResultsLabel: string;
}

/**
 * The outcome reported by {@link updateFindMatchesCount}.
 */
export interface IFindMatchesCountResult {
	/**
	 * The text written into the match-count element.
	 */
	readonly label: string;

	/**
	 * The width, in pixels, the match-count element requires: the larger of the supplied
	 * `currentMinimumWidth` and the element's measured `clientWidth`.
	 */
	readonly minimumWidth: number;
}

/**
 * Renders the match-count summary of a find operation into a widget's match-count element and
 * measures the width that element requires.
 *
 * Any text left by an earlier call is removed before the new text is appended, so the element holds
 * exactly one text node however often the function is called. An element that has not been laid out
 * yet measures `0`, so `currentMinimumWidth` is returned unchanged in that case.
 *
 * Nothing is localized and no accessibility announcement is made here: the caller supplies
 * already-localized text and announces the returned label itself.
 *
 * @param target The widget's match-count element, which is updated in place.
 * @param options The counts, labels and measurement described by {@link IFindMatchesCountOptions}.
 * @returns The rendered label and the required width, as described by
 * {@link IFindMatchesCountResult}.
 */
export function updateFindMatchesCount(target: HTMLElement, options: IFindMatchesCountOptions): IFindMatchesCountResult {
	const { currentMinimumWidth, matchesCount, matchesPosition, matchesLimit, limitTitle, matchesLocationLabel, noResultsLabel } = options;

	target.style.minWidth = currentMinimumWidth + 'px';
	target.title = (limitTitle !== undefined && matchesCount >= matchesLimit) ? limitTitle : '';

	// remove previous content
	target.firstChild?.remove();

	let label: string;
	if (matchesCount > 0) {
		let countText: string = String(matchesCount);
		if (matchesCount >= matchesLimit) {
			countText += '+';
		}
		label = strings.format(matchesLocationLabel, matchesPosition, countText);
	} else {
		label = noResultsLabel;
	}

	target.appendChild(document.createTextNode(label));

	return { label, minimumWidth: Math.max(currentMinimumWidth, target.clientWidth) };
}

/**
 * A widget control whose enabled state can be driven, such as a find input or an action button.
 */
export interface IFindReplaceEnableableControl {
	setEnabled(enabled: boolean): void;
}

/**
 * A widget control that renders either an expanded or a collapsed state, such as a replace-mode
 * toggle.
 */
export interface IFindReplaceExpandableControl {
	setExpanded(expanded: boolean): void;
}

/**
 * The state flags and controls consumed by {@link updateFindReplaceControlState}.
 */
export interface IFindReplaceControlStateOptions {
	/**
	 * Whether the widget is currently revealed.
	 */
	readonly visible: boolean;

	/**
	 * Whether the widget's replace section is currently revealed.
	 */
	readonly replaceVisible: boolean;

	/**
	 * The current find query. Its emptiness gates the replace buttons.
	 */
	readonly searchString: string;

	/**
	 * The find input.
	 */
	readonly findInput: IFindReplaceEnableableControl;

	/**
	 * The replace input.
	 */
	readonly replaceInput: IFindReplaceEnableableControl;

	/**
	 * The button that replaces the current match.
	 */
	readonly replaceBtn: IFindReplaceEnableableControl;

	/**
	 * The button that replaces every match.
	 */
	readonly replaceAllBtn: IFindReplaceEnableableControl;

	/**
	 * The button that reveals and hides the replace section.
	 */
	readonly toggleReplaceBtn: IFindReplaceExpandableControl;

	/**
	 * The widget's root element, which carries the `replaceToggled` class while the replace section
	 * is revealed.
	 */
	readonly rootNode: HTMLElement;
}

/**
 * Drives the enabled state of a find/replace widget's inputs and replace buttons, the expanded
 * state of its replace-mode toggle, and the `replaceToggled` class on its root element.
 *
 * The inputs follow the widget's visibility, the replace buttons additionally require a non-empty
 * query, and the root class and toggle follow the replace section's visibility.
 *
 * Four controls are left untouched: the selection-scope toggle, match navigation, the close button
 * and any read-only gating. A caller updates those itself.
 *
 * @param options The state flags and controls described by
 * {@link IFindReplaceControlStateOptions}.
 * @returns Whether the find query is non-empty. A caller that gates further controls on the same
 * condition can reuse the value; a caller that does not may ignore it.
 */
export function updateFindReplaceControlState(options: IFindReplaceControlStateOptions): boolean {
	const { visible, replaceVisible, searchString, findInput, replaceInput, replaceBtn, replaceAllBtn, toggleReplaceBtn, rootNode } = options;

	findInput.setEnabled(visible);
	replaceInput.setEnabled(visible && replaceVisible);

	const findInputIsNonEmpty = (searchString.length > 0);
	replaceBtn.setEnabled(visible && replaceVisible && findInputIsNonEmpty);
	replaceAllBtn.setEnabled(visible && replaceVisible && findInputIsNonEmpty);

	rootNode.classList.toggle('replaceToggled', replaceVisible);
	toggleReplaceBtn.setExpanded(replaceVisible);

	return findInputIsNonEmpty;
}
