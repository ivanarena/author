package com.author

import android.view.WindowManager
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityInstrumentedTest {
  @Test
  fun mainWindowAllowsScreenshots() {
    ActivityScenario.launch(MainActivity::class.java).use { scenario ->
      scenario.onActivity { activity ->
        val secureFlag = activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE
        assertEquals(0, secureFlag)
      }
    }
  }
}
