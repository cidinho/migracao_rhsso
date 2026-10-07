import { NO_VALID_GROUP_ERROR, type NormalizedRow, type PreviewGroup } from '../csv/csv-import.js';
import type { GroupsService } from '../groups/groups.service.js';

/**
 * Importação completa: valida os grupos pedidos em cada linha contra o realm.
 * Grupo inexistente não invalida a linha; só a linha sem nenhum grupo válido fica inválida.
 */
export async function checkRowGroups(groups: GroupsService, rows: NormalizedRow[], refresh = false): Promise<NormalizedRow[]> {
  const resolution = await groups.resolvePaths(
    rows.flatMap((r) => r.groups ?? []),
    refresh,
  );
  return rows.map((row) => {
    if (!row.groups?.length) return row;
    const seen = new Set<string>();
    const groupChecks = row.groups.flatMap((path): PreviewGroup[] => {
      const res = resolution.get(path)!;
      if (!res.ref) return [{ path, status: 'INEXISTENTE', motivo: res.motivo }];
      if (seen.has(res.ref.id)) return [];
      seen.add(res.ref.id);
      return [{ path: res.ref.path, status: 'OK', id: res.ref.id }];
    });
    const errors = groupChecks.some((g) => g.status === 'OK') ? row.errors : [...row.errors, NO_VALID_GROUP_ERROR];
    return { ...row, groupChecks, errors };
  });
}
