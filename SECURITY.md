# セキュリティ方針

## 対象境界

Hatter Consoleは公開Webサービスではありません。`localhost` origin、固定4213番、127.0.0.1 listen、exact Origin、no CORSを変更して公開bindすることはサポート外です。HostはWindows/WSLのローカル転送に限り、同一ポートの`localhost`、`127.0.0.1`、`[::1]`を同じループバック境界として扱い、安全なnavigationは`localhost`へ正規化します。`localhost`は正規ブラウザoriginです。Hatter自身はWebAuthn ceremonyを持ちません。reverse proxy、LAN共有、Cloudflare tunnelへの接続も禁止します。

Consoleはローカルファースト製品の所有者向け画面です。必須のSaaS制御面、
クラウド同期、遠隔debug authorityを持ちません。外部モデルまたはHAT workerを
使用する場合も、接続はHatterの明示bindingを通します。

## 認証情報

Hatterへの利用者認証や一回限りの起動URLはありません。固定のlocalhost URLを開くと、同一Originの接続で内部CookieとCSRFを自動取得します。これは本人確認ではなく、ローカルOS利用者を信頼する境界です。異なるOrigin・Host、CSRF不一致、操作nonceの再利用は拒否します。Cookieが失効した場合も利用者にログインを要求しません。

ChatGPT tokenは同一app-server processのephemeral storeだけで扱います。CSRF、opaque handle、readiness token、進行中の外部サービスlogin ceremonyはprocess memoryのみです。外部サービスの認証URL・device codeを共有しないでください。

ConsoleはVS Code、Codex CLI、他のChatGPT clientのcredentialを読み取り、コピー、importしません。表示する認証情報は状態、方式、プラン、保存範囲だけで、token、refresh secret、JWT、メールアドレス、アカウントIDを含みません。

## 表示情報

概要、プロフィール、診断、SSE、HAT package/binding/timeline projectionは秘密、account subject、source body、prompt、path、command、raw logを返しません。timelineはcanonical operation IDとopaque evidence referenceを上限付きで表示します。Consoleはthread、turn、review、command/file approvalを受け付けません。

全画面下部の診断Consoleも同じ投影境界に従います。provider例外やHTTP bodyを表示せず、
公開理由コード、領域、時刻、復旧説明、process-local診断IDだけを最大64件表示します。

通常のHAT導入候補は、Hatterごとにrevision選択した署名済みcatalogだけから取得します。
取得場所はHTTPSまたはローカルディレクトリですが、論理origin、署名キーID、Ed25519公開鍵を別に固定し、ローカルpathはブラウザ投影へ返しません。catalogが利用できない場合は
候補を推測せず空の利用不可状態を返します。HAT由来メニューは署名済みdomain termを
Console側のopaque handleへ変換し、固定routeへ投影します。package由来の任意route、
component、script、executableは受理しません。生のpackageや鍵入力は通常導入画面に置かず、
固定のシステム／デバッグ画面に限定します。

「HAT管理」は固定のシステム／デバッグ画面です。`gpt-5.6-sol` / `high` は
構成評価用の可視な事前選択であり、利用者の明示承認前には有効化しません。
承認状態は画面メモリだけに置き、通常HATの `low`（Light）へ継承しません。
暗黙の推論強度昇格や別モデルへのfallbackも行いません。

## 報告

脆弱性を公開issueへ貼り付けないでください。Hathqの非公開セキュリティ窓口へ、安定理由コード、版、再現操作だけを送付し、token、PEM、path、prompt、raw logを添付しないでください。
