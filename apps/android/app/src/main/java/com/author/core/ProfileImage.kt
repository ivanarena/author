package com.author.core

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

private const val PROFILE_IMAGE_SIZE = 256
private const val PROFILE_IMAGE_MAX_SOURCE_BYTES = 8 * 1024 * 1024
private const val PROFILE_IMAGE_MAX_OUTPUT_BYTES = 128 * 1024
private const val PROFILE_IMAGE_MAX_DIMENSION = 16_384
private const val PROFILE_IMAGE_MAX_PIXELS = 64_000_000L

private fun applyExifOrientation(bitmap: Bitmap, source: ByteArray): Bitmap {
  val orientation =
    runCatching {
        ExifInterface(ByteArrayInputStream(source))
          .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
      }
      .getOrDefault(ExifInterface.ORIENTATION_NORMAL)
  val matrix = Matrix()
  when (orientation) {
    ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
    ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
    ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
    ExifInterface.ORIENTATION_TRANSPOSE -> {
      matrix.setRotate(90f)
      matrix.postScale(-1f, 1f)
    }
    ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
    ExifInterface.ORIENTATION_TRANSVERSE -> {
      matrix.setRotate(-90f)
      matrix.postScale(-1f, 1f)
    }
    ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
    else -> return bitmap
  }
  return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
}

internal fun prepareProfileImage(uri: Uri, resolver: ContentResolver): String {
  val declaredSize = resolver.openAssetFileDescriptor(uri, "r")?.use { it.length }
  if (declaredSize != null && declaredSize > PROFILE_IMAGE_MAX_SOURCE_BYTES) {
    throw IllegalArgumentException("Profile picture source must be 8 MB or smaller")
  }

  val source =
    resolver.openInputStream(uri)?.use { input ->
      val output = ByteArrayOutputStream()
      val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
      var total = 0
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        total += read
        if (total > PROFILE_IMAGE_MAX_SOURCE_BYTES) {
          throw IllegalArgumentException("Profile picture source must be 8 MB or smaller")
        }
        output.write(buffer, 0, read)
      }
      output.toByteArray()
    } ?: throw IllegalArgumentException("Could not read that profile picture")
  if (source.isEmpty()) throw IllegalArgumentException("Could not read that profile picture")

  val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
  BitmapFactory.decodeByteArray(source, 0, source.size, bounds)
  val width = bounds.outWidth
  val height = bounds.outHeight
  if (
    width <= 0 ||
      height <= 0 ||
      width > PROFILE_IMAGE_MAX_DIMENSION ||
      height > PROFILE_IMAGE_MAX_DIMENSION ||
      width.toLong() * height.toLong() > PROFILE_IMAGE_MAX_PIXELS
  ) {
    throw IllegalArgumentException("Profile picture dimensions are too large")
  }

  var sampleSize = 1
  while (
    width / sampleSize > PROFILE_IMAGE_SIZE * 2 || height / sampleSize > PROFILE_IMAGE_SIZE * 2
  ) {
    sampleSize *= 2
  }
  val decoded =
    BitmapFactory.decodeByteArray(
      source,
      0,
      source.size,
      BitmapFactory.Options().apply { inSampleSize = sampleSize },
    ) ?: throw IllegalArgumentException("Could not decode that profile picture")

  val oriented = applyExifOrientation(decoded, source)
  try {
    val cropSize = minOf(oriented.width, oriented.height)
    val left = (oriented.width - cropSize) / 2
    val top = (oriented.height - cropSize) / 2
    val cropped = Bitmap.createBitmap(oriented, left, top, cropSize, cropSize)
    try {
      val scaled = Bitmap.createScaledBitmap(cropped, PROFILE_IMAGE_SIZE, PROFILE_IMAGE_SIZE, true)
      try {
        val flattened =
          Bitmap.createBitmap(PROFILE_IMAGE_SIZE, PROFILE_IMAGE_SIZE, Bitmap.Config.ARGB_8888)
        try {
          Canvas(flattened).apply {
            drawColor(Color.WHITE)
            drawBitmap(scaled, 0f, 0f, null)
          }
          for (quality in listOf(86, 74, 62)) {
            val output = ByteArrayOutputStream()
            flattened.compress(Bitmap.CompressFormat.JPEG, quality, output)
            val bytes = output.toByteArray()
            if (bytes.size <= PROFILE_IMAGE_MAX_OUTPUT_BYTES) {
              return "data:image/jpeg;base64,${Base64.encodeToString(bytes, Base64.NO_WRAP)}"
            }
          }
        } finally {
          flattened.recycle()
        }
      } finally {
        if (scaled !== cropped) scaled.recycle()
      }
    } finally {
      if (cropped !== decoded) cropped.recycle()
    }
  } finally {
    if (oriented !== decoded) oriented.recycle()
    decoded.recycle()
  }

  throw IllegalArgumentException("Profile picture could not be reduced below 128 KB")
}
