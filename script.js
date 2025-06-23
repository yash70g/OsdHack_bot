const { Client, GatewayIntentBits, PermissionsBitField, ChannelType, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const mongoose = require('mongoose');

const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const token = process.env.TOKEN;
const mongoUri = process.env.MONGO_URI;


mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });

const teamSchema = new mongoose.Schema({
    guildId: String,
    teamName: String,
    roleId: String,
    textChannelId: String,
    members: [String],
    devpost: [String],
    github: String
});

const Team = mongoose.model('Team', teamSchema);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const commands = [
    new SlashCommandBuilder()
        .setName('create_team')
        .setDescription('Create a team with role, channels, and permissions')
        .addStringOption(option =>
            option.setName('team_name')
                .setDescription('Name of the team')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('members')
                .setDescription('Mentioned Discord members (space separated)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('devpost')
                .setDescription('Devpost usernames (comma separated)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('github')
                .setDescription('GitHub repo URL')
                .setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('showteam')
        .setDescription('Show details of a team')
        .addStringOption(option =>
            option.setName('team_name')
                .setDescription('Name of the team')
                .setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('updateteam')
        .setDescription('Update team members, devpost usernames, or github repo')
        .addStringOption(option =>
            option.setName('team_name')
                .setDescription('Name of the team')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('members')
                .setDescription('Mentioned Discord members (space separated)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('devpost')
                .setDescription('Devpost usernames (comma separated)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('github')
                .setDescription('GitHub repo URL')
                .setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('showallteams')
        .setDescription('Show details of all teams')
        .toJSON()
];

const rest = new REST({ version: '10' }).setToken(token);

async function registerCommands() {
    try {
        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands }
        );
        console.log('Slash commands registered.');
    } catch (error) {
        console.error(error);
    }
}

registerCommands();

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'create_team') {
        await interaction.deferReply({ ephemeral: false });

        const teamName = interaction.options.getString('team_name');
        const membersRaw = interaction.options.getString('members');
        const devpostRaw = interaction.options.getString('devpost');
        const githubRepo = interaction.options.getString('github');

        const botMember = await interaction.guild.members.fetchMe();
        const authorMember = await interaction.guild.members.fetch(interaction.user.id);
        if (authorMember.roles.highest.position <= botMember.roles.highest.position) {
            const embed = new EmbedBuilder()
                .setTitle("Permission Denied")
                .setDescription("You don't have permission to use this command.")
                .setColor(0xff0000);
            return interaction.editReply({ embeds: [embed] });
        }

        const memberMentions = membersRaw.match(/<@!?(\d+)>/g) || [];
        if (memberMentions.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle("Missing Members")
                .setDescription("Please mention at least one member.")
                .setColor(0xff0000);
            return interaction.editReply({ embeds: [embed] });
        }
        const devpostUsernames = devpostRaw.split(',').map(u => u.trim()).filter(Boolean);
        if (devpostUsernames.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle("Missing Devpost Usernames")
                .setDescription("Please provide at least one Devpost username.")
                .setColor(0xff0000);
            return interaction.editReply({ embeds: [embed] });
        }

        let role = await interaction.guild.roles.create({
            name: teamName,
            mentionable: true,
            reason: `Team role for ${teamName}`
        });

        for (const mention of memberMentions) {
            const memberId = mention.replace(/[<@!>]/g, '');
            const member = await interaction.guild.members.fetch(memberId).catch(() => null);
            if (member) {
                await member.roles.add(role);
            }
        }

        await Team.findOneAndUpdate(
            { guildId: interaction.guild.id, teamName: teamName.toLowerCase() },
            {
                guildId: interaction.guild.id,
                teamName: teamName.toLowerCase(),
                roleId: role.id,
                textChannelId: null,
                members: memberMentions,
                devpost: devpostUsernames,
                github: githubRepo
            },
            { upsert: true, new: true }
        );

        const embed = new EmbedBuilder()
            .setTitle(`Team "${teamName}" Created`)
            .addFields(
                { name: 'Role', value: `<@&${role.id}>`, inline: true },
                { name: 'Devpost Usernames', value: devpostUsernames.join(', '), inline: false }
            )
            .setColor(0x00ff99);
        if (githubRepo) embed.addFields({ name: 'GitHub Repo', value: githubRepo, inline: false });

        await interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'showteam') {
        await interaction.deferReply({ ephemeral: false });
        let teamName = interaction.options.getString('team_name');
        if (teamName.startsWith('@')) teamName = teamName.slice(1).trim();
        const team = await Team.findOne({ guildId: interaction.guild.id, teamName: teamName.toLowerCase() });
        if (!team) {
            const embed = new EmbedBuilder()
                .setTitle("Team Not Found")
                .setDescription(`No team found with the name "${teamName}".`)
                .setColor(0xff0000);
            return interaction.editReply({ embeds: [embed] });
        }
        const embed = new EmbedBuilder()
            .setTitle(`Team "${teamName}" Details`)
            .addFields(
                { name: 'Role', value: `<@&${team.roleId}>`, inline: true },
                { name: 'Text Channel', value: team.textChannelId ? `<#${team.textChannelId}>` : 'N/A', inline: true },
                { name: 'Members', value: team.members.join(' '), inline: false },
                { name: 'Devpost Usernames', value: team.devpost.join(', '), inline: false }
            )
            .setColor(0x3399ff);
        if (team.github) embed.addFields({ name: 'GitHub Repo', value: team.github, inline: false });
        await interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'updateteam') {
        await interaction.deferReply({ ephemeral: true });
        let teamName = interaction.options.getString('team_name');
        if (teamName.startsWith('@')) teamName = teamName.slice(1).trim();
        const membersRaw = interaction.options.getString('members');
        const devpostRaw = interaction.options.getString('devpost');
        const githubRaw = interaction.options.getString('github');
        const team = await Team.findOne({ guildId: interaction.guild.id, teamName: teamName.toLowerCase() });

        const confirmButton = new ButtonBuilder()
        .setCustomId("confirm_button")
        .setLabel("Yes, update details")
        .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
        .setCustomId("cancel_button")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder()
        .addComponents(confirmButton, cancelButton);

        const response = await interaction.editReply({
            content: 'Are you absolutely sure you want to update team data? This action will delete all previous data!',
            components: [row],
            ephemeral: true,
        });

        const collectorFilter = i => i.user.id === interaction.user.id;

        try {
            const confirmation = await response.awaitMessageComponent({ filter: collectorFilter, time: 60_000 });

            if (confirmation.customId === 'confirm_button') {
                confirmButton.setDisabled(true);
                cancelButton.setDisabled(true);
                await confirmation.update({ components: [row] });
                if (!team) {
                    const embed = new EmbedBuilder()
                        .setTitle("Team Not Found")
                        .setDescription(`No team found with the name "${teamName}".`)
                        .setColor(0xff0000);
                    return interaction.editReply({ embeds: [embed] });
                }
                let updated = false;
                if (membersRaw) {
                    const memberMentions = membersRaw.match(/<@!?(\d+)>/g) || [];
                    team.members = memberMentions;
                    const role = await interaction.guild.roles.fetch(team.roleId);
                    const allMembers = await interaction.guild.members.fetch();
                    for (const member of allMembers.values()) {
                        if (member.roles.cache.has(role.id)) {
                            await member.roles.remove(role).catch(() => {});
                        }
                    }
                    for (const mention of memberMentions) {
                        const memberId = mention.replace(/[<@!>]/g, '');
                        const member = await interaction.guild.members.fetch(memberId).catch(() => null);
                        if (member) {
                            await member.roles.add(role).catch(() => {});
                        }
                    }
                    updated = true;
                }
                if (devpostRaw) {
                    const devpostUsernames = devpostRaw.split(',').map(u => u.trim()).filter(Boolean);
                    team.devpost = devpostUsernames;
                    updated = true;
                }
                if (githubRaw) {
                    team.github = githubRaw;
                    updated = true;
                }
                if (!updated) {
                    const embed = new EmbedBuilder()
                        .setTitle("Nothing to Update")
                        .setDescription("Please provide members and/or devpost usernames and/or github repo to update.")
                        .setColor(0xffcc00);
                    return interaction.editReply({ embeds: [embed] });
                }
                await team.save();
                const embed = new EmbedBuilder()
                    .setTitle(`Team "${teamName}" Updated`)
                    .addFields(
                        { name: 'Role', value: `<@&${team.roleId}>`, inline: true },
                        { name: 'Text Channel', value: team.textChannelId ? `<#${team.textChannelId}>` : 'N/A', inline: true },
                        { name: 'Members', value: team.members.join(' '), inline: false },
                        { name: 'Devpost Usernames', value: team.devpost.join(', '), inline: false }
                    )
                    .setColor(0x00ccff);
                if (team.github) embed.addFields({ name: 'GitHub Repo', value: team.github, inline: false });
                await interaction.editReply({ embeds: [embed] });
            } else if (confirmation.customId === 'cancel_button'){
                confirmButton.setDisabled(true);
                cancelButton.setDisabled(true);
                await confirmation.update({ content: 'Deletion cancelled.', components: [row] });
            }
        } catch (e) {
            confirmButton.setDisabled(true);
            cancelButton.setDisabled(true);
            await interaction.editReply({ content: 'Confirmation not received in time, action cancelled.', components: [row] });
        }
    }

    if (interaction.commandName === 'showallteams') {
        await interaction.deferReply({ ephemeral: false });
        const teams = await Team.find({ guildId: interaction.guild.id });
        if (!teams.length) {
            const embed = new EmbedBuilder()
                .setTitle("No Teams Found")
                .setDescription("There are no teams in this server.")
                .setColor(0xff0000);
            return interaction.editReply({ embeds: [embed] });
        }
        const embed = new EmbedBuilder()
            .setTitle("All Teams")
            .setColor(0x00bfff);

        for (const team of teams) {
            let value = `Role: <@&${team.roleId}>\nText: ${team.textChannelId ? `<#${team.textChannelId}>` : 'N/A'}\nMembers: ${team.members.join(' ')}\nDevpost: ${team.devpost.join(', ')}`;
            if (team.github) value += `\nGitHub: ${team.github}`;
            embed.addFields({ name: team.teamName, value: value.length > 1024 ? value.slice(0, 1021) + '...' : value, inline: false });
        }
        await interaction.editReply({ embeds: [embed] });
    }
});

client.login(token);
