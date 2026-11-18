package com.author.core

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

// On devices java.text.Collator is backed by ICU, like browsers; the JVM's own collator orders
// some letters differently, so this parity check with the web runs on a device.
@RunWith(AndroidJUnit4::class)
class ManuscriptOrderingInstrumentedTest {
  @Test
  fun ordersTitlesTheSameWayAsTheWebClient() {
    val notes =
      listOf("Zebra", "Ängel", "Apple", "Øre", "Oak", "chapter 10", "Chapter 2").mapIndexed {
        index,
        title ->
        ManuscriptSourceNote(index.toString(), title, "", "2026-01-01T00:00:00Z")
      }
    // Same expectation as manuscript.test.ts ("orders titles the same way in every language").
    assertEquals(
      listOf("Ängel", "Apple", "Chapter 2", "chapter 10", "Oak", "Øre", "Zebra"),
      orderManuscriptNotes(notes, ManuscriptOrder.TITLE) { it }.map { it.title },
    )
  }
}
