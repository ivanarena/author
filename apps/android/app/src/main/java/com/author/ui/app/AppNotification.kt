package com.author.ui.app

data class AppNotification(
  val id: String,
  val kind: String,
  val title: String,
  val message: String = "",
  val actionLabel: String = "",
)
