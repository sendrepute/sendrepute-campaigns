[English](README.md) · [العربية](README.ar.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Українська](README.uk.md) · [हिन्दी](README.hi.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [简体中文](README.zh.md) · [Tiếng Việt](README.vi.md)

# SendRepute Campaigns

Jalankan audiens, kampanye, templat, otomatisasi, dan pengiriman secara mandiri dari
server Anda. Repositori ini mendistribusikan **runtime yang dikompilasi**, bukan
keseluruhan monorepo sumber.

![Pratinjau desktop SendRepute Campaigns](docs/assets/campaigns-github-desktop.jpg)

Coba [demo interaktif](https://www.sendrepute.com/campaigns/?demo=true)
(tanpa pesan nyata, builder yang di-host, maupun hasil berbayar).

<a id="quickstart-fresh-ubuntu-24042604"></a>

## Mulai cepat: Ubuntu 24.04/26.04 baru

Di **server baru yang belum memiliki instalasi Campaigns**, jalankan:

```sh
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/sendrepute/sendrepute-campaigns.git
cd sendrepute-campaigns
./setup.sh
```

Setup akan menanyakan mode akses yang ingin digunakan dan menggunakan kembali Docker/Compose yang berfungsi; pada
server Ubuntu baru yang didukung namun belum terinstal Docker, setup akan meminta persetujuan untuk menginstal
paket bawaan Ubuntu. Proses ini tidak menghapus Snap Docker atau membypass AppArmor. Jangan menimpa
instalasi yang sudah ada dengan clone baru; lihat [Pembaruan](#update).

Pesan **CAMPAIGNS READY FOR OWNER SETUP** menandakan bahwa aplikasi beroperasi normal di dalam
container, bukan berarti setup pemilik telah selesai atau HTTPS publik telah diverifikasi.
Untuk HTTPS, verifikasi terlebih dahulu halaman instalasi yang tercetak dari jaringan lain:
halaman tersebut harus memiliki sertifikat tepercaya yang valid tanpa peringatan browser. Jika
sertifikat masih berstatus tertunda atau tidak valid, **jangan** masukkan data rahasia apa pun.

Untuk pemilik baru, token sekali pakai bersifat **wajib**, bukan opsional. Setelah
akses pilihan Anda siap, jalankan perintah ini di VPS **dari direktori proyek**:

```sh
sudo docker compose exec campaigns cat /var/lib/sendrepute-campaigns/installer-token
```

Abaikan `sudo` jika akun Docker Anda tidak memerlukannya. Salin output perintah
dan tempelkan ke kolom **Setup token** di halaman instalasi yang tercetak.
Isi detail pemilik serta Public URL terkait yang diakhiri dengan `/campaigns/`,
lalu selesaikan aktivasi SendRepute dan setup pemilik di wizard. Setup **tidak**
mencetak token secara otomatis. Jangan pernah meletakkan token ini di dalam URL atau membagikannya; jaga agar
token, `.env`, dan log tetap privat. Workspace yang sudah terinstal tidak
memerlukan token setup baru.

<a id="choose-access"></a>

## Pilih akses

- **Domain HTTPS (disarankan):** setup akan memulai proxy Caddy yang disertakan.
  Masukkan subdomain yang Anda kontrol, misalnya `campaigns.example.com` (ganti
  dengan milik Anda), **tanpa skema, port, atau path**. Arahkan record DNS
  `A` nama host tersebut ke server ini, izinkan TCP 80/443 dan periksa
  sertifikat tepercaya secara eksternal. Gunakan `AAAA` hanya jika IPv6 berfungsi.
- **Lokal / SSH tunnel:** me-bind aplikasi ke loopback VPS. Buka aplikasinya melalui
  SSH tunnel tepercaya dari komputer Anda; `localhost` laptop Anda bukanlah
  VPS tersebut.
- **IP Publik + HTTP:** memberikan persetujuan eksplisit untuk akses tanpa enkripsi pada port 8080.
  Kata sandi, token, dan sesi berisiko disadap; **tidak untuk deployment
  produksi yang aman**.

Lihat [panduan perintah setup (cookbook)](docs/install.md#guided-setup-command-cookbook)
untuk perintah spesifik, opsi, local SSH tunneling, diagnostik, dan peringatan.

<a id="moving-from-http-to-https"></a>

## Beralih dari HTTP ke HTTPS

Lakukan backup terlebih dahulu. Arahkan **nama host Anda yang sebenarnya** ke VPS, bebaskan/buka port TCP 80/443
dan pastikan DNS-nya berfungsi. Di VPS, di dalam direktori proyek yang **sudah ada**:

```sh
./setup.sh --mode https --host campaigns.sendrepute.com
```

Ganti `campaigns.sendrepute.com` dengan nama host Anda (`campaign` dan
`campaigns` adalah nama DNS yang berbeda). Konfirmasikan perubahan eksposur saat diminta;
setup akan memulai Caddy namun tidak akan menulis ulang Public URL yang tersimpan di workspace terinstal.
Setelah memverifikasi HTTPS secara eksternal, ubah URL tersebut di **Workspace
Settings** menjadi `https://YOUR_HOSTNAME/campaigns/`. Jika menggunakan Cloudflare, gunakan
**Full (strict)**, jangan pernah Flexible. Lihat
[langkah-langkah migrasi](docs/install.md#migrate-an-installed-public-ip-http-workspace-to-https)
sebelum mengubah instalasi aktif (live).

<a id="download-v0141"></a>

## Unduh v0.1.41

Administrator dapat memeriksa rilis GitHub stabil di Workspace Settings. Lampiran arsip Rilis resmi yang berversi dan checksum SHA-256 lebih diutamakan. Jika lampiran yang diharapkan tersebut tidak ada, pemeriksa dapat mengurai (resolve) tag rilis stabil yang sama di repositori resmi ke commit-nya yang tidak dapat diubah (immutable), lalu memvalidasi manifes checksum `downloads/` yang terikat pada commit tersebut. Tautan unduhan repositori disematkan pada commit tersebut, bukan pada tag atau branch yang dapat dipindah (movable). Lampiran yang diharapkan namun tidak valid atau ganda sama sekali tidak mengizinkan fallback ini. Pengaturan (Settings) menampilkan pemberitahuan pembaruan, tautan unduhan/checksum, dan perintah manual pembaruan server yang terdokumentasi untuk klon Git yang ada; sistem tidak pernah menginstal, mengekstrak, atau mengeksekusi unduhan. Lakukan backup instalasi terlebih dahulu, kemudian ikuti prosedur upgrade dan restart oleh operator. Instalasi arsip harus mengikuti instruksi upgrade arsip yang terpisah dan memverifikasi byte yang diunduh dengan checksum. Kegagalan GitHub, metadata publikasi yang tidak ada atau salah format, serta versi terinstal yang tidak diketahui akan dilaporkan sebagai tidak tersedia, dan tidak pernah dilaporkan sebagai versi terbaru (up to date). Arsip rilis baru menyertakan metadata versi terinstalnya; instalasi versi lama tanpa metadata ini tidak dapat mengklaim sebagai versi saat ini (current). Penerbitan rilis dan checksum adalah langkah operator yang terpisah, tidak dilakukan oleh aplikasi.

Lebih memilih arsip berversi? Unduh [ZIP](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.41/downloads/sendrepute-campaigns-0.1.41.zip)
atau [tar.gz](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.41/downloads/sendrepute-campaigns-0.1.41.tar.gz),
verifikasi [checksum SHA-256](https://github.com/sendrepute/sendrepute-campaigns/blob/v0.1.41/downloads/sendrepute-campaigns-0.1.41-SHA256SUMS),
ekstrak, dan jalankan `./setup.sh` di sana. Ini merupakan unduhan repositori, **bukan**
lampiran biner GitHub Release; **Code → Download ZIP** adalah snapshot yang
berbeda. Lihat [catatan rilis v0.1.41](https://github.com/sendrepute/sendrepute-campaigns/releases/tag/v0.1.41).

<a id="additional-tracking-hostnames"></a>

## Nama host pelacakan tambahan

Dengan instalasi HTTPS/Caddy bawaan yang sudah berjalan, buka **Domains**,
buat challenge nama host, tambahkan record A/AAAA-nya agar mengarah ke server ini beserta
record kepemilikan TXT persis seperti yang ditampilkan, lalu klik **Check DNS and verify**.
Campaigns secara otomatis menambahkan nama host yang telah diverifikasi tersebut ke proxy terkelola yang
sama dan menggunakan kembali sertifikat utama apabila SAN-nya mencakup nama host tersebut; jika tidak,
akan meminta sertifikat otomatis. Ulangi proses ini untuk beberapa nama host sekaligus; tidak diperlukan
perintah shell atau pengeditan proxy untuk tiap domain, dan pengaturan nama host
instalasi utama serta sertifikat tidak akan berubah. Pilih nama host terverifikasi yang diinginkan
secara mandiri pada dropdown **Tracking domain** di setiap kampanye.

Persetujuan DNS, konfigurasi proxy yang dimuat, dan HTTPS publik yang berfungsi ditampilkan
secara terpisah. Pemuatan konfigurasi tidak membuktikan penerbitan ACME atau jangkauan (reachability)
publik. Nama Origin CA yang tercakup mewajibkan proxying Cloudflare dan tidak
secara langsung dipercaya oleh browser. DNS dan port 80/443 harus mencapai proxy yang ada; Cloudflare
harus mengizinkan ACME dan tetap **Full (strict)**. Proxy/Tunnel eksternal membutuhkan
konfigurasi operator. Jika proxy terkelola tidak berjalan atau nama host utama
tidak ditemukan, penambahan akan tetap dalam antrean hingga masalah tingkat instalasi
tersebut diselesaikan. Tidak ada fallback SSL tidak aman yang dilakukan.

Rute yang telah disetujui sebelumnya tetap dipertahankan ketika domain yang dapat dipilih dihapus
atau challenge-nya dirotasi, sehingga tautan yang telah terkirim tidak dicabut secara diam-diam.
Pastikan DNS dan pembaruan sertifikatnya tetap tersedia. Pertahankan buku besar persetujuan
PostgreSQL dan volume HTTPS/Caddy selama upgrade/backup. Instalasi sertifikat utama
manual mungkin dapat mengganggu koneksi sesaat selama
update/restart yang terkontrol khusus untuk Caddy. Lihat `SMTP-TRACKING.md` bawaan
untuk definisi status, retensi tautan historis, dan batasan kegagalan/coba ulang.

<a id="update"></a>

## Pembaruan

Lakukan backup terlebih dahulu; lihat [Backup](#back-up).
Di VPS, **di dalam klon Git Anda yang sudah ada** (bukan klon baru), periksa
perubahan lokal, lalu jalankan:

```sh
git status --short
git pull --ff-only && ./setup.sh --mode resume
```

`resume` mempertahankan mode akses yang ada, termasuk HTTPS. Jika proses pull ditolak,
rekonsiliasi hasil edit alih-alih melakukan reset paksa. Pertahankan `.env`, proyek Compose
yang sama, PostgreSQL beserta volume aplikasi, dan kunci enkripsi. Jangan pernah menjalankan
`docker compose down -v` pada data riil. Untuk upgrade dari arsip, gunakan
[instruksi upgrade](docs/operations.md#upgrade), jangan membuat clone baru yang menimpa
instalasi saat ini.

<a id="back-up"></a>

## Backup

Pertahankan seluruh database PostgreSQL, data aplikasi/kunci enkripsi,
`.env` privat, dan state HTTPS/Caddy. Ikuti
[perintah backup Docker lengkap](docs/operations.md#docker-infrastructure-backup),
lalu simpan salinan off-host terenkripsi dengan akses terbatas. Ekspor JSON di dalam aplikasi
bukanlah backup infrastruktur dan tidak mencakup buku besar persetujuan HTTPS yang dipertahankan,
termasuk nama host yang disetujui yang baris domain pemilihannya telah dihapus.

Untuk backup off-host terenkripsi yang **dijadwalkan secara opt-in**, gunakan contoh
`backup.sh`, `backup.conf.example`, dan systemd yang disertakan. Tidak ada hal yang dijadwalkan
atau diaktifkan oleh proses setup. Instal `age` dan konfigurasi direktori off-host yang di-mount
atau tujuan SFTP yang dibatasi. Biarkan kedua pengaturan age kosong:
backup interaktif pertama akan otomatis membuat file pemulihannya (recovery) dan meminta
Anda untuk menyimpan salinan aman yang terpisah sebelum melanjutkan. Backup berikutnya menggunakan kembali file tersebut;
tidak ada perintah pembuatan kunci (key-generation) atau nilai kunci publik yang perlu disalin ke config.
Host menyimpan salinan yang dilindungi untuk memverifikasi setiap backup; jangan pernah menyimpan
salinan pemulihan independen Anda berdampingan dengan arsip backup terenkripsi.
Lihat [backup otomatis](docs/operations.md#opt-in-encrypted-scheduled-backups)
untuk prasyarat, aktivasi aman, verifikasi, dan pemulihan. Dari direktori instalasi,
`./backup.sh status` menampilkan upaya terakhir, keberhasilan terakhir, dan arsip;
ini tetap dapat dibaca meskipun identitas age atau tool backup tidak tersedia, asalkan
config privat milik operator dan file spool/status lokal masih utuh.
`./backup.sh verify /private/path/archive.tar.age` memeriksa dekripsi, manifes, dan
format PostgreSQL tanpa memulihkan (restore) data.

<a id="restore"></a>

## Restore

Lakukan restore hanya dari backup PostgreSQL **dan** volume data yang diverifikasi serta cocok;
ekspor JSON dalam aplikasi tidak mencakup tugas pengiriman (delivery jobs), event audit, dan state runtime
lainnya. Proses restore dapat menimpa data yang lebih baru atau melanjutkan pengiriman email dalam antrean. Ikuti
[langkah-langkah restore terisolasi](docs/operations.md#restore-to-an-empty-isolated-installation)
sebelum melakukan cutover apa pun ke lingkungan produksi.

<a id="more-information"></a>

## Informasi selengkapnya

- [Perintah instalasi dan setup](docs/install.md) — semua flag, HTTPS/HTTP,
  path Docker atau Node.js manual, token, dan pemecahan masalah.
- [Operasional, backup, dan restore](docs/operations.md) — upgrade dan pemulihan (recovery).
- [Keamanan dan keterkiriman](docs/security-and-deliverability.md) — SMTP,
  SPF/DKIM/DMARC, persetujuan, dan pemeriksaan produksi.
- [Kontrak server mandiri](docs/server-contract.md) — detail integrasi.

Aktivasi memvalidasi kunci API SendRepute yang diterbitkan secara terpisah; **tidak diperlukan deposit
untuk aktivasi**, dan manajemen lokal sepenuhnya gratis. Hosted AI dan klasifikasi
opsional memerlukan entitlement atau kredit tersendiri serta persetujuan harga
yang eksplisit; demo AI tidak menghasilkan output berbayar. Pengiriman berjalan dari **server
Anda ke relay/penyedia SMTP yang Anda konfigurasi**, bukan melalui proxy
SMTP pusat SendRepute.

<a id="release-boundary"></a>

## Batasan rilis

Rilis ini mencakup browser terkompilasi, server, pengiriman (delivery) dan jembatan customer-API,
SDK customer publik, migrasi, serta dokumentasi. Rilis ini mengecualikan situs utama
dan scanner SendRepute, konten database, secret, source map, test,
dan toolchain pengembangan. Syarat lisensi komponen dan pihak ketiga tetap
berlaku; self-hosting tidak memberikan lisensi layanan terkelola (hosted-service) atau jaminan
penempatan inbox (inbox-placement).
