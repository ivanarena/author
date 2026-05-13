package com.author.ui

data class AppNotification(
  val id: String,
  val kind: String,
  val title: String,
  val message: String = ""
)
