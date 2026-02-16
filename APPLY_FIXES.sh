#!/bin/bash
# Harmonia v3.0 バグ修正適用スクリプト

echo "🔧 Harmonia v3.0 バグ修正を適用中..."
echo ""

# 1. lrc-parser.jsの修正（簡単な修正）
echo "📝 lrc-parser.js を修正中..."
sed -i '38s/.*/        const msString = timeMatch[3] || '\''0'\'';/' lrc-parser.js
sed -i '39i\        const milliseconds = msString.length === 3 ?' lrc-parser.js
sed -i '40i\            parseInt(msString) :' lrc-parser.js
sed -i '41i\            parseInt(msString.padEnd(3, '\''0'\''));' lrc-parser.js
sed -i '39d' lrc-parser.js 2>/dev/null || true

echo "✅ lrc-parser.js 完了"
echo ""

echo "🎉 バグ修正の適用が完了しました！"
echo ""
echo "次のステップ:"
echo "1. ブラウザのキャッシュをクリア"
echo "2. ページをリロード"
echo "3. 開発者ツールでエラーがないか確認"
echo ""
echo "詳細は README.md を参照してください。"
