package com.dafung.web

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // 前台保屏:对局长等待(bot 回合/观战)不随系统超时熄屏;窗口不可见时该 flag 自动失效
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }
}
