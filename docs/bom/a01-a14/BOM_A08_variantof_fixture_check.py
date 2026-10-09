"""A-08 proposed-contract tests; independent of Workbench and not a production validator."""
from dataclasses import dataclass

@dataclass(frozen=True)
class Record:
    kind: str
    targets: tuple[str, ...] = ()


def validate(records):
    errors = []
    for source, record in records.items():
        if not record.targets:
            continue
        if record.kind != 'Object':
            errors.append('invalid-source')
        if len(record.targets) != 1:
            errors.append('multiple-targets')
        for target in record.targets:
            if target not in records:
                errors.append('unresolved-target')
            elif records[target].kind != 'Object':
                errors.append('invalid-target')
            if target == source:
                errors.append('self-reference')
    visiting, visited = set(), set()
    def dfs(node):
        if node in visiting:
            errors.append('cycle')
            return
        if node in visited:
            return
        visiting.add(node)
        for target in records[node].targets:
            if target in records and target != node:
                dfs(target)
        visiting.remove(node)
        visited.add(node)
    for node in records:
        dfs(node)
    return set(errors)


def variants_of(records, target):
    return sorted(src for src, rec in records.items() if target in rec.targets)

O = lambda *targets: Record('Object', targets)
R = lambda *targets: Record('Requirement', targets)
tests = [
    ('valid Object to Object', {'A': O('F'), 'F': O()}, set()),
    ('non-Object target rejected', {'A': O('R'), 'R': R()}, {'invalid-target'}),
    ('non-Object source rejected', {'R': R('F'), 'F': O()}, {'invalid-source'}),
    ('self link rejected', {'A': O('A')}, {'self-reference'}),
    ('directed cycle rejected', {'A': O('B'), 'B': O('C'), 'C': O('A')}, {'cycle'}),
    ('two targets rejected', {'A': O('B','C'), 'B': O(), 'C': O()}, {'multiple-targets'}),
    ('multiple members to family', {'A': O('F'), 'B': O('F'), 'F': O()}, set()),
    ('omitted relation valid', {'A': O()}, set()),
    ('dangling target rejected', {'A': O('X')}, {'unresolved-target'}),
]
if __name__ == '__main__':
    for name, case, expected in tests:
        actual = validate(case)
        assert actual == expected, f'{name}: got {actual}; wanted {expected}'
        print(f'PASS | {name} | {sorted(actual)}')
    family = {'A': O('F'), 'B': O('F'), 'F': O()}
    assert variants_of(family,'F') == ['A','B']
    assert family['F'].targets == ()  # no inverse materialized
    print('PASS | derived reverse lookup; target remains unchanged')
    print('RESULT: 10/10 PASS (proposed semantic fixture only)')
