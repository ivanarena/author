package com.author

import android.app.Application
import com.author.core.DebugLogStore

class NotesApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    DebugLogStore.record(this, "debug", "App", "Application started")
    UpdateCheckWorker.schedule(this)
  }
}
