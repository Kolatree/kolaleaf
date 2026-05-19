// OTPFieldTests.swift  (Phase 1 · U18)
// Validates the OTPFieldModel state machine that backs the OTPField view.
// View rendering is verified by snapshot tests in PhoneOTPView (U19); this file
// covers the input/paste/backspace/error logic that has actual branching.

import XCTest
@testable import Kolaleaf

@MainActor
final class OTPFieldTests: XCTestCase {

    // MARK: - Type 6 digits one at a time

    func test_typing6Digits_populatesAllBoxesAndFiresCallback() {
        var captured: String?
        let m = OTPFieldModel(length: 6, onComplete: { captured = $0 })

        for ch in "472956" { m.input(String(ch)) }

        XCTAssertEqual(m.digits, ["4", "7", "2", "9", "5", "6"])
        XCTAssertEqual(m.value, "472956")
        XCTAssertEqual(m.focusedIndex, nil, "Focus should release after the last digit")
        XCTAssertEqual(captured, "472956")
    }

    func test_typing_advancesFocusOneAtATime() {
        let m = OTPFieldModel(length: 6, onComplete: { _ in })
        m.beginEditing()
        XCTAssertEqual(m.focusedIndex, 0)

        m.input("1")
        XCTAssertEqual(m.focusedIndex, 1)
        m.input("2")
        XCTAssertEqual(m.focusedIndex, 2)
    }

    // MARK: - Paste / SMS autofill

    func test_pasting6Digits_distributesAcrossBoxesAndFiresCallback() {
        var captured: String?
        let m = OTPFieldModel(length: 6, onComplete: { captured = $0 })

        m.paste("472956")

        XCTAssertEqual(m.digits, ["4", "7", "2", "9", "5", "6"])
        XCTAssertEqual(captured, "472956")
    }

    func test_pasting_truncatesLongerInput() {
        let m = OTPFieldModel(length: 6, onComplete: { _ in })
        m.paste("12345678901234")
        XCTAssertEqual(m.digits, ["1", "2", "3", "4", "5", "6"])
    }

    func test_pasting_stripsNonDigits() {
        let m = OTPFieldModel(length: 6, onComplete: { _ in })
        m.paste("4-7 29 56")
        XCTAssertEqual(m.digits, ["4", "7", "2", "9", "5", "6"])
    }

    func test_pasting_shortInputDoesNotFireCompletion() {
        var captured: String?
        let m = OTPFieldModel(length: 6, onComplete: { captured = $0 })

        m.paste("4729")

        XCTAssertEqual(m.digits, ["4", "7", "2", "9", "", ""])
        XCTAssertNil(captured)
        XCTAssertEqual(m.focusedIndex, 4, "Focus should land on the next empty slot")
    }

    // MARK: - Backspace

    func test_backspaceFromBox4_focusesBox3() {
        let m = OTPFieldModel(length: 6, onComplete: { _ in })
        for ch in "1234" { m.input(String(ch)) }
        // Now box index 4 is focused, with box 3 holding "4".

        m.backspace()

        XCTAssertEqual(m.digits, ["1", "2", "3", "", "", ""])
        XCTAssertEqual(m.focusedIndex, 3,
                       "Backspacing into an empty box should move focus to the previous box and clear it")
    }

    func test_backspaceWhenCurrentBoxHasContent_clearsCurrentInPlace() {
        let m = OTPFieldModel(length: 6, onComplete: { _ in })
        m.beginEditing()
        m.digits = ["1", "2", "3", "", "", ""]
        m.focusedIndex = 2  // user tapped back into box 2 which holds "3"

        m.backspace()

        XCTAssertEqual(m.digits, ["1", "2", "", "", "", ""])
        XCTAssertEqual(m.focusedIndex, 2,
                       "Backspacing a non-empty box clears in place; focus does not move")
    }

    func test_backspaceFromBox0_isNoOp() {
        let m = OTPFieldModel(length: 6, onComplete: { _ in })
        m.beginEditing()
        m.backspace()
        XCTAssertEqual(m.focusedIndex, 0)
        XCTAssertEqual(m.digits, ["", "", "", "", "", ""])
    }

    // MARK: - Reject non-digits

    func test_typingNonDigit_isRejected() {
        let m = OTPFieldModel(length: 6, onComplete: { _ in })
        m.beginEditing()
        m.input("a")
        m.input("!")
        m.input(" ")
        XCTAssertEqual(m.digits, ["", "", "", "", "", ""])
        XCTAssertEqual(m.focusedIndex, 0)
    }

    func test_typingMultiCharString_takesFirstDigitOnly() {
        let m = OTPFieldModel(length: 6, onComplete: { _ in })
        m.beginEditing()
        m.input("4x")
        XCTAssertEqual(m.digits.first, "4")
        XCTAssertEqual(m.focusedIndex, 1)
    }

    // MARK: - Error state + reset

    func test_errorState_setsRedHighlight() {
        let m = OTPFieldModel(length: 6, onComplete: { _ in })
        XCTAssertFalse(m.isError)
        m.setError(true)
        XCTAssertTrue(m.isError)
    }

    func test_settingError_clearsOnNextInput() {
        let m = OTPFieldModel(length: 6, onComplete: { _ in })
        m.beginEditing()
        m.setError(true)
        m.input("1")
        XCTAssertFalse(m.isError, "Typing after an error should clear the error state")
    }

    func test_reset_clearsDigitsAndError() {
        let m = OTPFieldModel(length: 6, onComplete: { _ in })
        m.paste("123456")
        m.setError(true)

        m.reset()

        XCTAssertEqual(m.digits, ["", "", "", "", "", ""])
        XCTAssertFalse(m.isError)
        XCTAssertEqual(m.value, "")
    }

    // MARK: - Completion fires once and only once

    func test_completion_doesNotFireUntilAll6FilledAtOnce() {
        var fireCount = 0
        let m = OTPFieldModel(length: 6, onComplete: { _ in fireCount += 1 })
        for ch in "12345" { m.input(String(ch)) }
        XCTAssertEqual(fireCount, 0)
        m.input("6")
        XCTAssertEqual(fireCount, 1)
    }

    func test_completion_firesOncePerFullEntry_evenAfterReset() {
        var fireCount = 0
        let m = OTPFieldModel(length: 6, onComplete: { _ in fireCount += 1 })
        m.paste("123456")
        XCTAssertEqual(fireCount, 1)
        m.reset()
        m.paste("987654")
        XCTAssertEqual(fireCount, 2)
    }

    func test_completion_firesAgainWhenAggregateInputChangesAfterFullEntry() {
        var captured: [String] = []
        let m = OTPFieldModel(length: 6, onComplete: { captured.append($0) })

        m.paste("123456")
        m.paste("654321")

        XCTAssertEqual(captured, ["123456", "654321"])
    }

    func test_clearingAggregateInputResetsCompletionLatch() {
        var captured: [String] = []
        let m = OTPFieldModel(length: 6, onComplete: { captured.append($0) })

        m.paste("123456")
        m.paste("")
        m.paste("222222")

        XCTAssertEqual(captured, ["123456", "222222"])
    }
}
