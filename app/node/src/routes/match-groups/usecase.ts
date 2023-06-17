import { v4 as uuidv4 } from "uuid";
import {
  MatchGroupDetail,
  MatchGroupConfig,
  UserForFilter,
} from "../../model/types";
import {
  getMatchGroupDetailByMatchGroupId,
  getUserIdsBeforeMatched,
  hasSkillNameRecord,
  insertMatchGroup,
} from "./repository";
import { getUserForFilter } from "../users/repository";
import { RowDataPacket } from "mysql2";
import pool from "../../util/mysql";
import { convertToUserForFilter } from "../../model/utils";

export const checkSkillsRegistered = async (
  skillNames: string[]
): Promise<string | undefined> => {
  for (const skillName of skillNames) {
    if (!(await hasSkillNameRecord(skillName))) {
      return skillName;
    }
  }

  return;
};

export const createMatchGroup = async (
  matchGroupConfig: MatchGroupConfig,
  timeout?: number
): Promise<MatchGroupDetail | undefined> => {
  const owner = await getUserForFilter(matchGroupConfig.ownerId);
  let members: UserForFilter[] = [owner];
  const startTime = Date.now();
  const [departmentId] = await pool.query<RowDataPacket[]>(
    "SELECT department_id FROM department WHERE department_name = ?",
    [owner.departmentName]
  );
  const [officeId] = await pool.query<RowDataPacket[]>(
    "SELECT office_id FROM office WHERE office_name = ?",
    [owner.officeName]
  );
  const [skillIds] = await pool.query<RowDataPacket[]>(
    "SELECT skill_id FROM skill WHERE skill_name IN (?)",
    [owner.skillNames]
  );
  let candidatesIds: RowDataPacket[] = [];
  if (matchGroupConfig.departmentFilter === "onlyMyDepartment") {
    [candidatesIds] = await pool.query<RowDataPacket[]>(
      "SELECT user_id FROM department_role_member WHERE department_id = ?",
      [departmentId[0].department_id]
    );
    console.log("onlyMyDepartment:", departmentId[0], candidatesIds);
  }
  if (matchGroupConfig.departmentFilter === "excludeMyDepartment") {
    [candidatesIds] = await pool.query<RowDataPacket[]>(
      "SELECT user_id FROM department_role_member WHERE department_id <> ?",
      [departmentId[0].department_id]
    );
    console.log("excludeMyDepartment:", candidatesIds);
  }
  if (matchGroupConfig.skillFilter.length > 0) {
    console.log(skillIds);
    if (candidatesIds.length === 0)
      [candidatesIds] = await pool.query<RowDataPacket[]>(
        "SELECT user_id FROM skill_member WHERE skill_id IN (?)",
        [skillIds]
      );
    else
      [candidatesIds] = await pool.query<RowDataPacket[]>(
        "SELECT user_id FROM skill_member WHERE skill_id IN (?) AND user_id IN (?)",
        [skillIds, candidatesIds]
      );
    console.log("skillFilter:", candidatesIds);
  }
  if (matchGroupConfig.neverMatchedFilter) {
    const [matchGroupIdRows] = await pool.query<RowDataPacket[]>(
      "SELECT match_group_id FROM match_group_member WHERE user_id = ?",
      [owner.userId]
    );
    if (candidatesIds.length === 0) {
      if (matchGroupIdRows.length !== 0) {
        [candidatesIds] = await pool.query<RowDataPacket[]>(
          "SELECT user_id FROM match_group_member WHERE user_id <> ? AND match_group_id IN (?)",
          [owner.userId, matchGroupIdRows]
        );
      }
    } else {
      [candidatesIds] = await pool.query<RowDataPacket[]>(
        "SELECT user_id FROM match_group_member WHERE user_id <> ? AND match_group_id IN (?) AND user_id IN (?)",
        [owner.userId, matchGroupIdRows, candidatesIds]
      );
    }
    console.log("neverMatchedFilter:", candidatesIds);
  }

  if (matchGroupConfig.officeFilter === "onlyMyOffice") {
    if (candidatesIds.length === 0)
      [candidatesIds] = await pool.query<RowDataPacket[]>(
        "SELECT user_id FROM user WHERE office_id = ?",
        [officeId[0].office_id]
      );
    else
      [candidatesIds] = await pool.query<RowDataPacket[]>(
        "SELECT user_id FROM user WHERE office_id = ? AND user_id IN (?)",
        [officeId[0].office_id, candidatesIds]
      );
    console.log("onlyMyOffice:", candidatesIds);
  }
  if (matchGroupConfig.officeFilter === "excludeMyOffice") {
    if (candidatesIds.length === 0)
      [candidatesIds] = await pool.query<RowDataPacket[]>(
        "SELECT user_id FROM user WHERE office_id <> ?",
        [officeId[0].office_id]
      );
    else
      [candidatesIds] = await pool.query<RowDataPacket[]>(
        "SELECT user_id FROM user WHERE office_id <> ? AND user_id IN (?)",
        [officeId[0].office_id, candidatesIds]
      );
    console.log("excludeMyOffice:", candidatesIds);
  }

  let i = 0;
  while (members.length < matchGroupConfig.numOfMembers) {
    // デフォルトは50秒でタイムアウト
    if (Date.now() - startTime > (!timeout ? 50000 : timeout)) {
      console.error("not all members found before timeout");
      return;
    }
    let candidate: UserForFilter;
    if (candidatesIds.length === 0 || candidatesIds.length >= i)
      candidate = await getUserForFilter();
    else {
      const [userRows] = await pool.query<RowDataPacket[]>(
        "SELECT user_id, user_name, office_id, user_icon_id FROM user WHERE user_id = ?",
        [candidatesIds[i++]]
      );
      const user = userRows[0];

      const [officeNameRow] = await pool.query<RowDataPacket[]>(
        `SELECT office_name FROM office WHERE office_id = ?`,
        [user.office_id]
      );
      const [fileNameRow] = await pool.query<RowDataPacket[]>(
        `SELECT file_name FROM file WHERE file_id = ?`,
        [user.user_icon_id]
      );
      const [departmentNameRow] = await pool.query<RowDataPacket[]>(
        `SELECT department_name FROM department WHERE department_id = (SELECT department_id FROM department_role_member WHERE user_id = ? AND belong = true)`,
        [user.user_id]
      );
      const [skillNameRows] = await pool.query<RowDataPacket[]>(
        `SELECT skill_name FROM skill WHERE skill_id IN (SELECT skill_id FROM skill_member WHERE user_id = ?)`,
        [user.user_id]
      );

      user.office_name = officeNameRow[0].office_name;
      user.file_name = fileNameRow[0].file_name;
      user.department_name = departmentNameRow[0].department_name;
      user.skill_names = skillNameRows.map((row) => row.skill_name);

      candidate = convertToUserForFilter(user);
    }
    console.log(new Date(), ": getUserForFilter");
    if (
      matchGroupConfig.departmentFilter !== "none" &&
      !isPassedDepartmentFilter(
        matchGroupConfig.departmentFilter,
        owner.departmentName,
        candidate.departmentName
      )
    ) {
      console.log(`${candidate.userId} is not passed department filter`);
      continue;
    } else if (
      matchGroupConfig.officeFilter !== "none" &&
      !isPassedOfficeFilter(
        matchGroupConfig.officeFilter,
        owner.officeName,
        candidate.officeName
      )
    ) {
      console.log(`${candidate.userId} is not passed office filter`);
      continue;
    } else if (
      matchGroupConfig.skillFilter.length > 0 &&
      !matchGroupConfig.skillFilter.some((skill) =>
        candidate.skillNames.includes(skill)
      )
    ) {
      console.log(`${candidate.userId} is not passed skill filter`);
      continue;
    } else if (
      matchGroupConfig.neverMatchedFilter &&
      !(await isPassedMatchFilter(matchGroupConfig.ownerId, candidate.userId))
    ) {
      console.log(`${candidate.userId} is not passed never matched filter`);
      continue;
    } else if (members.some((member) => member.userId === candidate.userId)) {
      console.log(`${candidate.userId} is already added to members`);
      continue;
    }
    console.log(new Date(), ": all filtered");
    members = members.concat(candidate);
    console.log(`${candidate.userId} is added to members`);
  }

  const matchGroupId = uuidv4();
  await insertMatchGroup({
    matchGroupId,
    matchGroupName: matchGroupConfig.matchGroupName,
    description: matchGroupConfig.description,
    members,
    status: "open",
    createdBy: matchGroupConfig.ownerId,
    createdAt: new Date(),
  });

  return await getMatchGroupDetailByMatchGroupId(matchGroupId);
};

const isPassedDepartmentFilter = (
  departmentFilter: string,
  ownerDepartment: string,
  candidateDepartment: string
) => {
  return departmentFilter === "onlyMyDepartment"
    ? ownerDepartment === candidateDepartment
    : ownerDepartment !== candidateDepartment;
};

const isPassedOfficeFilter = (
  officeFilter: string,
  ownerOffice: string,
  candidateOffice: string
) => {
  return officeFilter === "onlyMyOffice"
    ? ownerOffice === candidateOffice
    : ownerOffice !== candidateOffice;
};

const isPassedMatchFilter = async (ownerId: string, candidateId: string) => {
  const userIdsBeforeMatched = await getUserIdsBeforeMatched(ownerId);
  const res = userIdsBeforeMatched.every(
    (userIdBeforeMatched) => userIdBeforeMatched !== candidateId
  );
  console.log(new Date(), ": isPassedMatchFilter");
  return res;
};
