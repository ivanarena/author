package com.author.notes

import android.app.Application

class AuthorApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    UpdateCheckWorker.schedule(this)
  }
}
