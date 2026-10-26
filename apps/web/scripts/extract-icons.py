"""Extract SVG strings from @web3icons/core modules without executing them."""
import os, re, sys

src, out = sys.argv[1], sys.argv[2]
UNSAFE = re.compile(r"<script|<foreignObject|\son\w+\s*=|javascript:|<use[^>]+href=\"http", re.I)

def read_svg(path):
    text = open(path, encoding='utf-8').read()
    m = re.match(r"\s*var\s+[\w$]+\s*=\s*'((?:[^'\\]|\\.)*)'\s*\n", text, re.S)
    if not m:
        return None
    s = re.sub(r"\\(.)", lambda e: {'n': '\n', 't': '\t'}.get(e.group(1), e.group(1)), m.group(1))
    s = s.replace(' class="web3icons"', '')
    if not s.lstrip().startswith('<svg') or UNSAFE.search(s):
        return None
    return s

def write(dest, svg):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(svg)

skipped = []
coins_dir = os.path.join(src, 'tokens', 'branded')
seen = set()
for name in sorted(os.listdir(coins_dir)):
    if not name.endswith('.svg.js'):
        continue
    ticker = name[:-len('.svg.js')].upper()
    if ticker in seen or not re.fullmatch(r'[A-Z0-9.]{1,15}', ticker):
        continue
    svg = read_svg(os.path.join(coins_dir, name))
    if svg is None:
        skipped.append(name); continue
    seen.add(ticker)
    write(os.path.join(out, 'coins', ticker + '.svg'), svg)

# canonical network id -> (kind, source name)
NETWORKS = {
    'bitcoin': ('networks', 'bitcoin'), 'ethereum': ('networks', 'ethereum'), 'tron': ('networks', 'tron'),
    'bsc': ('networks', 'binance-smart-chain'), 'solana': ('networks', 'solana'), 'polygon': ('networks', 'polygon'),
    'arbitrum': ('networks', 'arbitrum-one'), 'optimism': ('networks', 'optimism'), 'base': ('networks', 'base'),
    'avax': ('networks', 'avalanche'), 'litecoin': ('networks', 'litecoin'), 'dogecoin': ('tokens', 'DOGE'),
    'bitcoincash': ('tokens', 'BCH'), 'monero': ('tokens', 'XMR'), 'ripple': ('networks', 'xrp'),
    'ton': ('networks', 'ton'), 'cardano': ('networks', 'cardano'), 'zksyncera': ('networks', 'zksync'),
    'linea': ('networks', 'linea'),
}
for net, (kind, name) in NETWORKS.items():
    svg = read_svg(os.path.join(src, kind, 'branded', name + '.svg.js'))
    if svg is None:
        skipped.append(f'network {net}'); continue
    write(os.path.join(out, 'networks', net + '.svg'), svg)
    if net == 'ton' and 'TON' not in seen:  # no TON token icon upstream; reuse the network mark
        write(os.path.join(out, 'coins', 'TON.svg'), svg)
        seen.add('TON')

print(f'coins: {len(seen)}, networks: {len(NETWORKS)}, skipped: {len(skipped)}', skipped[:10])
