package expo.modules.orionudp

import android.content.Context
import android.net.wifi.WifiManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.DatagramPacket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.util.Collections

/**
 * 极简 UDP 模块，只为 SSDP 投屏发现服务。
 *
 * 为什么不用 react-native-udp：那个库停留在 RN 0.6x 时代，在模块加载时就取
 * `NativeModules.UdpSockets`，一旦 autolink 失效就直接抛异常把 release 包带崩
 * （用户看到的「点投屏闪退」）。这里只用系统自带的 MulticastSocket，行为可控。
 *
 * JS 侧 API：
 *   open(port)            -> 实际绑定端口
 *   send(host, port, text)-> true
 *   close()               -> void
 *   事件 onMessage { data, address }
 */
class OrionUdpModule : Module() {
  @Volatile
  private var socket: MulticastSocket? = null

  private var receiverThread: Thread? = null
  private var multicastLock: WifiManager.MulticastLock? = null

  override fun definition() = ModuleDefinition {
    Name("OrionUdp")

    Events("onMessage")

    AsyncFunction("open") { port: Int ->
      closeSocket()
      // 部分 ROM 不加组播锁就收不到别的设备回的包（权限已在清单里声明）
      acquireMulticastLock()

      val created = MulticastSocket(port)
      created.reuseAddress = true
      created.timeToLive = 4
      socket = created

      val group = InetAddress.getByName("239.255.255.250")
      val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
      for (nif in interfaces) {
        try {
          if (nif.isUp && !nif.isLoopback && nif.supportsMulticast()) {
            created.joinGroup(InetSocketAddress(group, port), nif)
          }
        } catch (_: Throwable) {
          // 单个网卡加入失败不影响其他网卡
        }
      }

      startReceiver(created)
      created.localPort
    }

    AsyncFunction("send") { host: String, port: Int, payload: String ->
      val current = socket ?: return@AsyncFunction false
      val data = payload.toByteArray(Charsets.UTF_8)
      current.send(DatagramPacket(data, data.size, InetAddress.getByName(host), port))
      true
    }

    AsyncFunction("close") {
      closeSocket()
    }

    OnDestroy {
      closeSocket()
    }
  }

  private fun startReceiver(target: MulticastSocket) {
    receiverThread = Thread {
      val buffer = ByteArray(8192)
      while (!target.isClosed) {
        try {
          val packet = DatagramPacket(buffer, buffer.size)
          target.receive(packet)
          val text = String(packet.data, 0, packet.length, Charsets.UTF_8)
          sendEvent(
            "onMessage",
            mapOf(
              "data" to text,
              "address" to (packet.address?.hostAddress ?: "")
            )
          )
        } catch (_: Throwable) {
          // close() 会让 receive 抛异常，属于正常退出路径
          if (target.isClosed) break
        }
      }
    }.also { it.isDaemon = true; it.name = "orion-udp"; it.start() }
  }

  private fun acquireMulticastLock() {
    if (multicastLock?.isHeld == true) return
    try {
      val context = appContext.reactContext ?: return
      val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
      val lock = wifi.createMulticastLock("orion-udp")
      lock.setReferenceCounted(false)
      lock.acquire()
      multicastLock = lock
    } catch (_: Throwable) {
      // 拿不到锁也能工作，只是个别设备可能收不到组播
    }
  }

  private fun closeSocket() {
    try {
      multicastLock?.takeIf { it.isHeld }?.release()
    } catch (_: Throwable) {
    }
    multicastLock = null

    try {
      socket?.close()
    } catch (_: Throwable) {
    }
    socket = null
    receiverThread = null
  }
}
